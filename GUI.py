import sys
import os
import webbrowser
import threading
from pathlib import Path
import cv2
import numpy as np
import torch
import requests
from ultralytics import YOLO
from filterpy.kalman import UnscentedKalmanFilter as UKF
from filterpy.kalman import MerweScaledSigmaPoints
from scipy.stats import multivariate_normal
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

# ==========================================
# 1️⃣ Path Logic (Essential for .exe)
# ==========================================
# This determines where the .exe is sitting so it can find your GUI and Models
if getattr(sys, 'frozen', False):
    # Running as a compiled .exe
    base_dir = os.path.dirname(sys.executable)
else:
    # Running as a normal .py script
    base_dir = os.path.dirname(os.path.abspath(__file__))

def get_resource_path(relative_path):
    """ Helper to join the base path with the file name """
    return os.path.join(base_dir, relative_path)

# Hardware Connection Details
ESP_BASE_URL = "http://192.168.4.1"
device = 'cuda' if torch.cuda.is_available() else 'cpu'

# Space Agency Constants
L, dt, n_leo = 0.1, 1.0 / 30.0, 0.0011
HARD_BODY_RADIUS = 0.5 
SAFETY_THRESHOLD = 0.1 
COLLISION_CRITERIA = HARD_BODY_RADIUS + SAFETY_THRESHOLD 

# ==========================================
# 2️⃣ SSA Logic & Orbital Functions 
# ==========================================
def hx(x, f_x, f_y, c_x, c_y):
    """ Measurement function (Mapping 3D to 2D image) """
    z_safe = max(x[2], 0.1)
    return np.array([f_x * x[0] / z_safe + c_x, f_y * x[1] / z_safe + c_y])

def fx_safe(x, dt):
    """ Prediction function (Clohessy-Wiltshire equations) """
    c, s = np.cos(n_leo * dt), np.sin(n_leo * dt)
    F = np.zeros((6, 6))
    F[0,0], F[0,3] = c, s/n_leo
    F[1,1], F[1,4], F[1,5] = (4-3*c), (1/n_leo)*s, (2/n_leo)*(1-c)
    F[2,2], F[2,5] = c, s/n_leo
    F[3,0], F[3,3] = -n_leo*s, c
    F[4,1], F[4,4], F[4,5] = 3*n_leo*s, c, 2*s
    F[5,2], F[5,5] = -n_leo*s, c
    return F @ x

def calculate_pc_accurate(miss_distance, covariance_3d, radius):
    """ Probability of Collision calculation """
    cov_2d = covariance_3d[:2, :2]
    try:
        rv = multivariate_normal(mean=[miss_distance, 0], cov=cov_2d)
        limit = radius
        prob = rv.cdf([limit, limit]) - rv.cdf([-limit, -limit])
        return max(0.0, prob * 100.0) 
    except: return 0.0

# ==========================================
# 3️⃣ Flask Server Setup (The "Brain")
# ==========================================
app = Flask(__name__, static_folder=base_dir, static_url_path='')
CORS(app)

@app.route('/')
def index():
    """ Serves the main GUI page """
    return send_from_directory(base_dir, 'index.html')

@app.route('/run-ai', methods=['GET'])
def run_mission_api():
    """ The core mission trigger called by the 'Run AI' button """
    try:
        # Fetch current scenario from hardware
        print("📡 Connecting to Zomoroda NodeMCU...")
        esp_req = requests.get(f"{ESP_BASE_URL}/get-scenario", timeout=5)
        ds = esp_req.json()['scenario']
    except Exception as e:
        print(f"❌ Connection Error: {e}")
        return jsonify({"error": "No connection to Satellite. Check Wi-Fi."}), 500

    # Locate Assets
    MODEL_PATH = get_resource_path("models/yolo26n_finalisa_best.pt")
    DATASET_ROOT = Path(get_resource_path(f"datasets/{ds}"))
    
    # Initialize YOLO
    model = YOLO(str(MODEL_PATH)).to(device)
    img_files = sorted([f for f in DATASET_ROOT.rglob("*") if f.suffix.lower() in ['.png', '.jpg']])
    
    if not img_files:
        return jsonify({"error": f"Dataset folder '{ds}' is empty or missing."}), 404

    # Setup Kalman Filter
    sample = cv2.imread(str(img_files[0]))
    h, w = sample.shape[:2]
    f_x, f_y, c_x, c_y = 500*(w/512), 500*(h/512), w/2, h/2
    pts = MerweScaledSigmaPoints(n=6, alpha=0.1, beta=2., kappa=0)
    ukf = UKF(dim_x=6, dim_z=2, fx=fx_safe, hx=lambda x: hx(x, f_x, f_y, c_x, c_y), dt=dt, points=pts)
    ukf.Q, ukf.R, ukf.P = np.diag([1e-7]*3 + [1e-7]*3), np.diag([30.0, 30.0]), np.diag([0.8]*6)

    history = {'pc': 0, 'min_dist': float('inf'), 'tca_frame': 0}
    is_init, maneuver_triggered = False, False

    # Process Frames
    for curr_frame in range(90 + 300):
        if is_init: ukf.predict()
        y_c = None
        if curr_frame < len(img_files):
            res = model(str(img_files[curr_frame]), verbose=False, device=device)[0]
            if len(res.boxes) > 0:
                b = res.boxes.xyxy[0].cpu().numpy()
                y_c = np.array([(b[0]+b[2])/2, (b[1]+b[3])/2])

        if curr_frame <= 90:
            if y_c is not None:
                if not is_init:
                    p_max = max(b[2]-b[0], b[3]-b[1])
                    Z = f_y * L / (p_max + 1e-6)
                    ukf.x[:3] = [(y_c[0]-c_x)*Z/f_x, (y_c[1]-c_y)*Z/f_y, Z]
                    is_init = True
                else:
                    ukf.update(y_c)
            
            if curr_frame == 90 and is_init:
                # Predictive collision check
                temp_x = ukf.x.copy()
                pred_dmin = float('inf')
                for _ in range(500):
                    temp_x = fx_safe(temp_x, dt)
                    d = np.linalg.norm(temp_x[:3])
                    if d < pred_dmin: pred_dmin = d
                if pred_dmin <= COLLISION_CRITERIA: maneuver_triggered = True
        else:
            curr_dist = np.linalg.norm(ukf.x[:3])
            effective_dist = max(curr_dist, HARD_BODY_RADIUS)
            if effective_dist < history['min_dist']:
                history['min_dist'] = effective_dist
                history['tca_frame'] = curr_frame
                history['pc'] = calculate_pc_accurate(effective_dist, ukf.P[:3,:3], COLLISION_CRITERIA)

    # Format Results
    tca_rel_time = round((history['tca_frame'] - 90) * dt, 3)
    return jsonify({
        "scenario": ds,
        "decision": "MANEUVER" if maneuver_triggered else "SAFE",
        "min_dist_m": round(history['min_dist'], 2),
        "pc_percentage": f"{history['pc']:.4f}%",
        "tca_sec": tca_rel_time
    })

# ==========================================
# 4️⃣ Launcher
# ==========================================
if __name__ == "__main__":
    def open_browser():
        webbrowser.open("http://localhost:5000")

    # Launch GUI 1.5 seconds after server starts
    threading.Timer(1.5, open_browser).start()

    print("🚀 Zomoroda AI Engine active at http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)