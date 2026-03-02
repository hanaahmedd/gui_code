  // =====================
// Global variables
// =====================
let latestCDM = null;
let latestTelemetry = null;
let propulsionLog = []; // store Bluetooth messages
let port, reader;
let serialBuffer = "";

// =====================
// Firebase Integration
// =====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, set, onValue } 
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

  const firebaseConfig = {
    apiKey: "AIzaSyCmBzL0wqU877XeDrFbaxt2F6FHuTCV3mo",
    authDomain: "ground-station-6c392.firebaseapp.com",
    databaseURL: "https://ground-station-6c392-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "ground-station-6c392",
    storageBucket: "ground-station-6c392.firebasestorage.app",
    messagingSenderId: "681592339112",
    appId: "1:681592339112:web:2916bf576be88c5ea5a09d",
    measurementId: "G-QPLJLXVZ04"
  };

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
function logToFirebase(path, data) {
    const dataRef = ref(db, path);
    push(dataRef, {
        ...data,
        timestamp: new Date().toISOString()
    });
}

// =====================
// Window load: fetch telemetry & dashboard setup
// =====================
window.addEventListener("load", () => {
  fetch("telemetry.json")
    .then(response => response.json())
    .then(data => {
      latestTelemetry = data;
      fillTelemetry(data);
      if (data.payload.propulsion) {
        fillPropulsion(data.payload.propulsion);
        logToFirebase('system/propulsion', data.payload.propulsion);
      }
      const aiResult = data.payload.ai_classification.result.toLowerCase();
      if (aiResult.includes("debris")) {
        const debris = data.payload.debris_info || {};
        latestCDM = {
          id: `CDM_${Date.now()}`,
          relative_velocity: debris.relative_velocity ? debris.relative_velocity + " m/s" : "Unknown",
          risk_level: calculateRisk(debris.distance),
          time_to_conjunction: estimateTime(debris.relative_velocity, debris.distance),
          miss_distance: debris.distance ? debris.distance + " m" : "Unknown"
        };
        fillCDM(latestCDM);
    logToFirebase('detections/cdm_events', latestCDM);
      }
    })
    .catch(error => {
      console.error("Error loading telemetry:", error);
    });

  // Typing effect for welcome text
  const text = "🌌 Welcome to Our Space";
  const element = document.getElementById("welcome-text");
  let index = 0;

  const typeWriter = () => {
    if (index < text.length) {
      element.innerHTML += text.charAt(index);
      index++;
      setTimeout(typeWriter, 100);
    }
  };
  typeWriter();
  setTimeout(() => {
    const welcome = document.getElementById("welcome");
    welcome.classList.add("fade-out");
    setTimeout(() => {
      welcome.style.display = "none";
      document.getElementById("main").style.display = "block";
    }, 1000);
  }, 5000);
});

// =====================
// Fill telemetry functions
// =====================
function fillTelemetry(data) {
  const healthEl = document.getElementById("payload-health-label");
  const batteryBar = document.getElementById("payload-battery-bar");

  let batteryLevel = typeof data.payload.battery_level === "number" ? data.payload.battery_level : 100;
  let batteryClass = "";
  let healthText = data.payload.health || "Unknown";

  if (batteryLevel >= 70) batteryClass = "green";
  else if (batteryLevel >= 40) batteryClass = "yellow";
  else if (batteryLevel >= 20) batteryClass = "orange";
  else batteryClass = "red";

  healthEl.textContent = healthText;

  let inner = batteryBar.querySelector('.battery-bar-inner');
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'battery-bar-inner';
    batteryBar.appendChild(inner);
  }
  inner.style.width = batteryLevel + "%";
  inner.className = 'battery-bar-inner ' + batteryClass;
  batteryBar.className = 'battery-bar ' + batteryClass;

  document.getElementById("payload-status").textContent = data.payload.payload_status;
  document.getElementById("ai-result").textContent =
    `${data.payload.ai_classification.result} (${data.payload.ai_classification.confidence}%)`;

    set(ref(db, 'system/current_status'), {
        health: data.payload.health,
        battery: data.payload.battery_level,
        status: data.payload.payload_status,
        lastUpdate: new Date().toISOString()
    });
}

function fillCDM(cdm) {
  document.getElementById("cdm-id").textContent = cdm.id;
  document.getElementById("cdm-velocity").textContent = cdm.relative_velocity;

  const riskEl = document.getElementById("cdm-risk");
  riskEl.textContent = cdm.risk_level;
  riskEl.className = cdm.risk_level === "HIGH" ? "status-critical" :
                     cdm.risk_level === "MEDIUM" ? "status-warning" : "status-healthy";

  document.getElementById("cdm-time").textContent = cdm.time_to_conjunction;
  document.getElementById("cdm-distance").textContent = cdm.miss_distance;
}

function calculateRisk(distance) {
  if (!distance) return "UNKNOWN";
  if (distance < 500) return "HIGH";
  if (distance < 1500) return "MEDIUM";
  return "LOW";
}

function estimateTime(velocity, distance) {
  if (!velocity || !distance) return "Unknown";
  const hours = distance / velocity;
  return `${Math.round(hours)} hours`;
}

// =====================
// Bluetooth / Propulsion
// =====================
const connectBtn = document.getElementById("connect-propulsion");
connectBtn.onclick = async () => {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    readSmartSerial();
    alert("Propulsion & Imaging System connected!");
    
    if (typeof updatePayloadUI === "function") updatePayloadUI();
    
  } catch (err) {
    console.error("Connection error:", err);
    alert("Failed to connect: " + err.message);
  }
};

// =====================
// Smart Serial Reader (Binary + Text)
// =====================
async function readSmartSerial() {
  const decoder = new TextDecoder();
  let imageBuffer = [];
  let isReceivingImage = false;
  let expectedSize = 0;

  reader = port.readable.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read(); // value is a Uint8Array
      if (done) break;

      if (isReceivingImage) {
        // --- BINARY MODE: Collecting Image Bytes ---
        for (let i = 0; i < value.length; i++) {
          imageBuffer.push(value[i]);
          
          // NEW: Update the Progress Bar width
          const progressBar = document.getElementById("image-progress-bar");
          if (progressBar && expectedSize > 0) {
            let percent = Math.floor((imageBuffer.length / expectedSize) * 100);
            progressBar.style.width = percent + "%";
          }

          if (imageBuffer.length >= expectedSize) {
            renderSatelliteImage(imageBuffer); 
            imageBuffer = [];
            isReceivingImage = false;
            
            // Hide progress bar after 1 second
            setTimeout(() => {
              const progressCont = document.getElementById("image-progress-container");
              if (progressCont) progressCont.style.display = "none";
            }, 1000);

            // Handle any text data that might be stuck at the end of the image buffer
            if (i < value.length - 1) {
              const remaining = value.slice(i + 1);
              processTextLine(decoder.decode(remaining));
            }
            break;
          }
        }
     } else {
    // TEXT MODE: Listen for the Trigger
    const chunk = decoder.decode(value);
    serialBuffer += chunk; // Accumulate incoming text
    processTextLine(chunk); 

    if (serialBuffer.toUpperCase().includes("IMG_START")) {
        console.log("!!! TRIGGER DETECTED IN BUFFER !!!");
        
        const sizeMatch = serialBuffer.match(/IMG_START:?\s*(\d+)/i);
        
        if (sizeMatch) {
            expectedSize = parseInt(sizeMatch[1]);
            isReceivingImage = true;
            imageBuffer = [];
            serialBuffer = ""; // Clear buffer for next time
            
           const progressCont = document.getElementById("image-progress-container");
const progressBar = document.getElementById("image-progress-bar");
if (progressCont) {
    progressCont.style.display = "block";
}
if (progressBar) {
    progressBar.style.width = "0%";
}
        }
    }
        if (serialBuffer.length > 200) serialBuffer = serialBuffer.substring(100);
}
    } 
  } catch (err) {
    console.error("Stream Error:", err);
  } finally {
    if (reader) reader.releaseLock();
  }
}

// =====================
// Helper: Process Text & Update Logs
// =====================
function processTextLine(text) {
  if (!text || !text.trim()) return;
  const logEl = document.getElementById("prop-log");
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");

  lines.forEach(line => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    
    if (Array.isArray(propulsionLog)) {
        propulsionLog.push({ timestamp: timeStr, message: line });
    }
    if (logEl) {
      const p = document.createElement("div");
      p.textContent = `[${timeStr}] ${line}`;
      logEl.appendChild(p);
      logEl.scrollTop = logEl.scrollHeight;
    }

    logToFirebase('propulsion/logs', { message: line });
    console.log("SATELLITE LOG:", line);
  });
}

// =====================
// Render Image Function
// =====================
function renderSatelliteImage(buffer) {
  const uint8Array = new Uint8Array(buffer);
  const blob = new Blob([uint8Array], { type: "image/jpeg" });
  const url = URL.createObjectURL(blob);
  
  const imgElement = document.getElementById("satellite-image");
  const placeholder = document.getElementById("image-placeholder");

  if (imgElement) {
    imgElement.src = url;
    imgElement.style.display = "block";
    if (placeholder) placeholder.style.display = "none";
    
    const sizeLabel = document.getElementById("incoming-size");
    if (sizeLabel) sizeLabel.textContent = uint8Array.length + " bytes";
  }
}

// =====================
// Download CDM button
// =====================
const downloadBtn = document.getElementById("download-cdm");
downloadBtn.onclick = () => {
  if (!latestTelemetry || !latestCDM) {
    alert("No CDM data available to download.");
    return;
  }
  const now = new Date();
  const downloadTimestamp = now.toISOString();
  const cdmWithTimestamp = {
    ...latestCDM,
    id: `CDM_${downloadTimestamp.replace(/[:.]/g, '-')}`
  };

  const exportData = {
    timestamp: downloadTimestamp,
    system_status: latestTelemetry.system_status,
    payload: {
      payload_status: latestTelemetry.payload.payload_status,
      health: latestTelemetry.payload.health,
      battery_level: latestTelemetry.payload.battery_level,
      ai_classification: latestTelemetry.payload.ai_classification,
      debris_info: latestTelemetry.payload.debris_info || {},
      propulsion_log: propulsionLog,
      cdm: cdmWithTimestamp
    }
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `CDM_${downloadTimestamp.replace(/[:.]/g, '-')}.json`;
  link.click();
};

// =====================
// Sidebar Functionality
// =====================
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarItems = document.querySelectorAll('.sidebar-item');
const sections = document.querySelectorAll('.dashboard-section');
const dashboardContainer = document.querySelector('.dashboard-container');

sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  dashboardContainer.classList.toggle('sidebar-collapsed');
  sidebarToggle.classList.toggle('active');
 
  sidebar.style.display = 'none';
  sidebar.offsetHeight; // Trigger reflow
  sidebar.style.display = 'block';
});

sidebarItems.forEach(item => {
  item.addEventListener('click', () => {
    sidebarItems.forEach(i => i.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    const sectionId = item.getAttribute('data-section') + '-section';
    document.getElementById(sectionId).classList.add('active');
  });
});

document.addEventListener('click', (e) => {
  if (window.innerWidth <= 768 && 
      !sidebar.contains(e.target) && 
      !sidebarToggle.contains(e.target) &&
      dashboardContainer.classList.contains('sidebar-collapsed') === false) {
    sidebar.classList.add('collapsed');
    dashboardContainer.classList.add('sidebar-collapsed');
    sidebarToggle.classList.add('active');
  }
});

// =====================
// Unified Connection Logic
// =====================
const payloadConnectBtn = document.getElementById("payload-connect-bt");
const payloadStartBtn = document.getElementById("payload-start-camera");

if (payloadConnectBtn) {
  payloadConnectBtn.addEventListener('click', async () => {
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 }); 
      
      updatePayloadUI();
      readSmartSerial(); 
      
      alert("Satellite Link Established!");
    } catch (err) {
      console.error("Connection error:", err);
      alert("Connection Failed: " + err.message);
    }
  });
}

function updatePayloadUI() {
  const dot = document.getElementById("payload-bt-dot");
  const text = document.getElementById("payload-bt-text");
  if (text) text.textContent = "BLUETOOTH: CONNECTED";
  if (dot) {
    dot.style.background = "#00ff00";
    dot.style.boxShadow = "0 0 10px #00ff00";
  }
  if (payloadConnectBtn) payloadConnectBtn.style.display = "none";
  if (payloadStartBtn) payloadStartBtn.style.display = "block";
}

// =====================
// Final Logic for "START CAMERA"
// =====================
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'payload-start-camera') {
    if (!port || !port.writable) {
      alert("Bluetooth Link Offline. Please connect first.");
      return;
    }
    try {
      const writer = port.writable.getWriter();
      const encoder = new TextEncoder();
      
      await writer.write(encoder.encode("START\n"));
      writer.releaseLock();

      updatePayloadUI(); 
      e.target.innerText = "CAMERA ACTIVE";
      e.target.style.borderColor = "#00ff00";
      e.target.style.color = "#00ff00";
      
      logToFirebase('system/camera', { status: "ACTIVE" });
      console.log("Camera Start Signal Sent.");
    } catch (err) {
      console.error("Camera trigger failed:", err);
      alert("Failed to reach Camera System.");
    }
  }
});
