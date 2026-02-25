  // =====================
// Global variables
// =====================
let latestCDM = null;
let latestTelemetry = null;
let propulsionLog = []; // store Bluetooth messages
let port, reader;

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

// Helper to log events to Firebase
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
  // Fetch telemetry data from JSON file
  fetch("telemetry.json")
    .then(response => response.json())
    .then(data => {
      latestTelemetry = data;
      fillTelemetry(data);

      // Fill propulsion if exists
      if (data.payload.propulsion) {
        fillPropulsion(data.payload.propulsion);
      }

      // Generate CDM dynamically if debris detected
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

        // NEW: Send to Firebase
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

  // Transition from welcome screen to main dashboard after 5 seconds
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

    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    reader = decoder.readable.getReader();

    readPropulsionSerial();
    alert("Propulsion connected!");
  } catch (err) {
    console.error(err);
    alert("Failed to connect propulsion.");
  }
};

async function readPropulsionSerial() {
  const logEl = document.getElementById("prop-log");

  function appendLog(msg) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const logEntry = { timestamp: timeStr, message: msg };
    propulsionLog.push(logEntry);

    const p = document.createElement("div");
    p.textContent = `[${timeStr}] ${msg}`;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
    // NEW: Send to Firebase
    logToFirebase('propulsion/logs', { message: msg });
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        const lines = value.split(/\r?\n/).filter(l => l.trim() !== "");
        lines.forEach(line => {
          appendLog(line);
          // parse JSON burn data if needed
        });
      }
    }
  } catch (err) {
    console.error("Error reading propulsion:", err);
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

// Toggle sidebar collapse/expand
sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  dashboardContainer.classList.toggle('sidebar-collapsed');
  sidebarToggle.classList.toggle('active');
  
  // Force reflow to fix icon display
  sidebar.style.display = 'none';
  sidebar.offsetHeight; // Trigger reflow
  sidebar.style.display = 'block';
});

// Sidebar navigation
sidebarItems.forEach(item => {
  item.addEventListener('click', () => {
    // Remove active class from all items and sections
    sidebarItems.forEach(i => i.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active'));
    
    // Add active class to clicked item and corresponding section
    item.classList.add('active');
    const sectionId = item.getAttribute('data-section') + '-section';
    document.getElementById(sectionId).classList.add('active');
  });
});

// Close sidebar on mobile when clicking outside
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

