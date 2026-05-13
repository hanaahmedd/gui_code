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

function addCDMCard(cdm) {
  if(!cdm) return;
  
  const container = document.getElementById("cdm-list-container");
  const card = document.createElement("div");
  card.className = "cdm-card";
  
  const isManeuver = cdm.decision === "MANEUVER_REQUIRED";
  const decisionColor = isManeuver ? "#ff4444" : "#00ffff"; 
  const borderColor = isManeuver ? "#ff4444" : "#00ffff";

  card.style.cssText = `
    background: linear-gradient(145deg, rgba(0, 20, 30, 0.8) 0%, rgba(0, 10, 15, 0.9) 100%);
    border-left: 4px solid ${borderColor};
    border-radius: 8px;
    padding: 15px 20px;
    position: relative;
    box-shadow: 0 8px 15px rgba(0,0,0,0.5), inset 0 0 10px rgba(0, 255, 255, 0.02);
    color: #e0e0e0;
    transition: transform 0.2s ease;
  `;

  const relPos = cdm.relative_position_RIC_m ? `${cdm.relative_position_RIC_m.r}, ${cdm.relative_position_RIC_m.t}, ${cdm.relative_position_RIC_m.n}` : "--";
  const relVel = cdm.relative_velocity_RIC_mps ? `${cdm.relative_velocity_RIC_mps.v_total}` : "--";

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(0, 255, 255, 0.1); padding-bottom: 10px; margin-bottom: 15px;">
        <div>
            <h3 style="margin: 0; color: #fff; font-size: 1.3em; letter-spacing: 1px;">
                Event ID: <span style="color:#00ffff; text-shadow: 0 0 5px rgba(0,255,255,0.4);">${cdm.event_id || "--"}</span>
            </h3>
            <span style="font-size: 0.85em; color: #888; text-transform: uppercase; letter-spacing: 1px;">Scenario: ${cdm.scenario || "--"}</span>
        </div>
        <button class="delete-cdm-btn" title="Remove this CDM" 
                onmouseover="this.style.background='rgba(255, 68, 68, 0.2)';" 
                onmouseout="this.style.background='rgba(255, 68, 68, 0.05)';"
                style="background: rgba(255, 68, 68, 0.05); color: #ff4444; border: 1px solid #ff4444; border-radius: 4px; cursor: pointer; padding: 4px 10px; font-weight: bold; transition: all 0.2s;">
            ✕
        </button>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; font-size: 0.9em;">
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 5px;"><strong style="color:#00ffff; display:block; font-size:0.75em; text-transform:uppercase; margin-bottom:2px;">Time to TCA</strong> ${cdm.time_to_tca_days || "--"} d</div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 5px;"><strong style="color:#00ffff; display:block; font-size:0.75em; text-transform:uppercase; margin-bottom:2px;">Risk PC</strong> ${cdm.risk_pc_percent || "--"} %</div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 5px;"><strong style="color:#00ffff; display:block; font-size:0.75em; text-transform:uppercase; margin-bottom:2px;">Miss Dist</strong> ${cdm.miss_distance_m || "--"} m</div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 5px;"><strong style="color:#00ffff; display:block; font-size:0.75em; text-transform:uppercase; margin-bottom:2px;">Type</strong> ${cdm.c_object_type || "--"}</div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 5px;"><strong style="color:#00ffff; display:block; font-size:0.75em; text-transform:uppercase; margin-bottom:2px;">Span</strong> ${cdm.c_span_m || "--"} m</div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 5px;"><strong style="color:#00ffff; display:block; font-size:0.75em; text-transform:uppercase; margin-bottom:2px;">Pos (r,t,n)</strong> ${relPos}</div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 5px;"><strong style="color:#00ffff; display:block; font-size:0.75em; text-transform:uppercase; margin-bottom:2px;">Vel Total</strong> ${relVel} m/s</div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 5px;"><strong style="color:#00ffff; display:block; font-size:0.75em; text-transform:uppercase; margin-bottom:2px;">Sigma (R,T,N)</strong> ${cdm.c_sigma_r || "--"}, ${cdm.c_sigma_t || "--"}, ${cdm.c_sigma_n || "--"}</div>
    </div>
    
    <div style="margin-top: 15px; text-align: center; background: ${isManeuver ? 'rgba(255, 0, 0, 0.08)' : 'rgba(0, 255, 255, 0.05)'}; border: 1px solid ${isManeuver ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 255, 255, 0.2)'}; padding: 12px; border-radius: 6px; box-shadow: inset 0 0 15px ${isManeuver ? 'rgba(255,0,0,0.15)' : 'rgba(0,255,255,0.05)'};">
       <strong style="text-transform: uppercase; letter-spacing: 2px; font-size: 0.8em; color: #888;">System Decision</strong><br>
       <div style="margin-top: 5px; color: ${decisionColor}; font-weight: bold; font-size: 1.4em; letter-spacing: 2px; text-shadow: 0 0 12px ${decisionColor};">
           ${cdm.decision || "--"}
       </div>
    </div>

    <button class="send-bt-btn" title="Send this CDM to Satellite" 
            onmouseover="this.style.background='rgba(0, 150, 255, 0.2)'; this.style.boxShadow='0 0 10px rgba(0,150,255,0.4)';" 
            onmouseout="this.style.background='rgba(0, 150, 255, 0.05)'; this.style.boxShadow='none';"
            style="width: 100%; margin-top: 10px; background: rgba(0, 150, 255, 0.05); color: #00bfff; border: 1px solid #00bfff; border-radius: 4px; cursor: pointer; padding: 10px; font-weight: bold; transition: all 0.2s; letter-spacing: 1px;">
        📡 SEND JSON VIA BLUETOOTH
    </button>
  `;

  // Delete card logic
  const deleteBtn = card.querySelector(".delete-cdm-btn");
  deleteBtn.addEventListener("click", () => card.remove());

  // Send over Bluetooth logic
  const sendBtn = card.querySelector(".send-bt-btn");
  sendBtn.addEventListener("click", () => {
     sendCDMToHardware(cdm, sendBtn);
  });

  container.prepend(card);
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
// --- ADD CDM UPLOAD LOGIC ---
const cdmFileInput = document.getElementById("cdm-file-upload");
const addCdmBtn = document.getElementById("add-cdm-btn");

if(addCdmBtn && cdmFileInput) {
  addCdmBtn.addEventListener("click", () => {
    cdmFileInput.click();
  });

  cdmFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        addCDMCard(json); // <-- This is the only line that changed here!
      } catch (err) {
        alert("Error: Please upload a valid CDM JSON file.");
      }
    };
    reader.readAsText(file);
    event.target.value = ""; // Reset file input so you can upload the same file again
  });
}

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

// =======================================================
// --- CDM SPECIFIC BLUETOOTH CONNECT BUTTON ---
// =======================================================
const connectCdmBtn = document.getElementById("connect-cdm-bt");

if (connectCdmBtn) {
  connectCdmBtn.addEventListener("click", async () => {
    try {
      // Check if the port is already open from another button on the dashboard
      if (typeof port !== 'undefined' && port && port.readable) {
          alert("✅ Satellite is already connected!");
          return;
      }

      // If not connected, open the port selection window
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 }); // HC-05 / ESP32 standard speed
      
      alert("✅ Connected successfully! You can now send CDM data.");
      
      // Optional: change button appearance to show it is connected
      connectCdmBtn.innerHTML = "✅ SATELLITE CONNECTED";
      connectCdmBtn.style.background = "#00ff00";
      
    } catch (e) {
      console.error("Connection error:", e);
      if (e.message.includes("already open")) {
          alert("✅ Satellite is already connected!");
      } else {
          alert("❌ Could not connect. Make sure your Bluetooth module is paired to your laptop.");
      }
    }
  });
}


// =======================================================
// --- BLUETOOTH TRANSMISSION LOGIC ---
// =======================================================
async function sendCDMToHardware(cdmData, btnElement) {
    if (typeof port === 'undefined' || !port || !port.writable) {
        alert("⚠️ Please connect to the hardware first using the 'Connect ESP32 (Hardware)' button on the dashboard!");
        return;
    }

    const originalText = btnElement.innerHTML;
    const originalColor = btnElement.style.color;
    
    btnElement.innerHTML = "⏳ TRANSMITTING...";
    btnElement.style.color = "orange";
    btnElement.style.borderColor = "orange";

    try {
        // --- 🔴 THE MAGIC HAPPENS HERE 🔴 ---
        // We create a new, smaller package with ONLY the 4 things the ESP32 needs.
        const hardwarePayload = {
            scenario: cdmData.scenario,
            event_id: cdmData.event_id,
            risk_pc_percent: cdmData.risk_pc_percent,
            decision: cdmData.decision
        };

        // We stringify the SMALL package instead of the whole file
        const jsonString = JSON.stringify(hardwarePayload) + "\n";
        // ------------------------------------
        
        const encoder = new TextEncoder();
        const writer = port.writable.getWriter();
        await writer.write(encoder.encode(jsonString));
        writer.releaseLock(); 

        btnElement.innerHTML = "✅ SENT SUCCESSFULLY!";
        btnElement.style.color = "#00ff00";
        btnElement.style.borderColor = "#00ff00";
        
        setTimeout(() => {
            btnElement.innerHTML = originalText;
            btnElement.style.color = originalColor;
            btnElement.style.borderColor = originalColor;
        }, 3000);

    } catch (error) {
        console.error("Error sending Bluetooth data:", error);
        
        btnElement.innerHTML = "❌ FAILED TO SEND";
        btnElement.style.color = "red";
        btnElement.style.borderColor = "red";
        
        setTimeout(() => {
            btnElement.innerHTML = originalText;
            btnElement.style.color = originalColor;
            btnElement.style.borderColor = originalColor;
        }, 3000);
    }
}

// ==========================================
// TRIGGER PYTHON AI SERVER 
// ==========================================
document.getElementById("run-ai-btn").addEventListener("click", async () => {
    const btn = document.getElementById("run-ai-btn");
    const loadingText = document.getElementById("ai-loading-text");

    // Show loading state and disable button
    loadingText.style.display = "block";
    btn.disabled = true;
    btn.style.opacity = "0.5";

    // Reset previous results to "--" while AI is calculating
    document.getElementById("payload-scenario").innerText = "--";
    document.getElementById("payload-min-dist").innerText = "--";
    document.getElementById("payload-pc").innerText = "--";
    document.getElementById("payload-tca").innerText = "--";
    document.getElementById("payload-decision").innerText = "--";
    document.getElementById("payload-decision").style.color = "#fff";

    try {
        // Ping the background Python server
        let response = await fetch("http://localhost:5000/run-ai");
        
        if (!response.ok) {
            throw new Error("Python server error");
        }

        // Get the calculated results
        let results = await response.json();

        // Update the GUI with the answers
        document.getElementById("payload-scenario").innerText = results.scenario;
        document.getElementById("payload-min-dist").innerText = results.min_dist_m + " m";
        document.getElementById("payload-pc").innerText = results.pc_percentage;
        document.getElementById("payload-tca").innerText = results.tca_sec + " s";
        
        const decisionSpan = document.getElementById("payload-decision");
        decisionSpan.innerText = results.decision;
        if(results.decision === "MANEUVER") {
             decisionSpan.style.color = "#ff4444"; // Red alert!
        } else {
             decisionSpan.style.color = "#00ff00"; // Green safe!
        }

        console.log("✅ AI Payload Loaded!");

    } catch (error) {
        console.error("AI Fetch Error:", error);
        alert("❌ Could not connect to the AI Engine. Is the main.py script running?");
    } finally {
        // Reset button and hide loading text
        loadingText.style.display = "none";
        btn.disabled = false;
        btn.style.opacity = "1";
    }
});
