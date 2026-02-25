// =====================
// Global variables
// =====================
let latestCDM = null;
let latestTelemetry = null;
let propulsionLog = []; 
let port, reader;

// =====================
// Firebase Logic & Window Load
// =====================
window.addEventListener("load", () => {
    // 1. Reference to your "telemetry" node in the Firebase cloud
    // window.db and window.onValue are provided by the script in your HTML
    const telemetryRef = window.dbRef(window.db, 'telemetry');

    // 2. LIVE Listener: Replaces fetch("telemetry.json")
    window.onValue(telemetryRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            console.log("Data received from Firebase:", data);
            latestTelemetry = data;
            fillTelemetry(data);

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
            }
        }
    }, (error) => {
        console.error("Firebase Read Error:", error);
    });

    // 3. Typing effect for welcome text
    runTypewriter();

    // 4. Transition to main dashboard
    setTimeout(() => {
        const welcome = document.getElementById("welcome");
        if (welcome) {
            welcome.classList.add("fade-out");
            setTimeout(() => {
                welcome.style.display = "none";
                document.getElementById("main").style.display = "block";
            }, 1000);
        }
    }, 5000);
});

// =====================
// Media Upload Function (Server Storage)
// =====================
async function uploadMedia(file) {
    // Uses the storage reference passed from HTML
    const storageRef = window.sRef(window.storage, 'debris_media/' + file.name);
    try {
        await window.uploadBytes(storageRef, file);
        const url = await window.getDownloadURL(storageRef);
        console.log("File available at server:", url);
        return url; 
    } catch (error) {
        console.error("Upload failed:", error);
    }
}

// =====================
// UI Helper Functions
// =====================
function runTypewriter() {
    const text = "🌌 Welcome to Our Space";
    const element = document.getElementById("welcome-text");
    if (!element) return;
    
    let index = 0;
    const typeWriter = () => {
        if (index < text.length) {
            element.innerHTML += text.charAt(index);
            index++;
            setTimeout(typeWriter, 100);
        }
    };
    typeWriter();
}

function fillTelemetry(data) {
    const healthEl = document.getElementById("payload-health-label");
    const batteryBar = document.getElementById("payload-battery-bar");
    if (!healthEl || !batteryBar) return;

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
if (connectBtn) {
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
}

async function readPropulsionSerial() {
    const logEl = document.getElementById("prop-log");

    function appendLog(msg) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

        const logEntry = { timestamp: timeStr, message: msg };
        propulsionLog.push(logEntry);

        if (logEl) {
            const p = document.createElement("div");
            p.textContent = `[${timeStr}] ${msg}`;
            logEl.appendChild(p);
            logEl.scrollTop = logEl.scrollHeight;
        }
    }

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
                const lines = value.split(/\r?\n/).filter(l => l.trim() !== "");
                lines.forEach(line => appendLog(line));
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
if (downloadBtn) {
    downloadBtn.onclick = () => {
        if (!latestTelemetry || !latestCDM) {
            alert("No CDM data available to download.");
            return;
        }

        const now = new Date();
        const downloadTimestamp = now.toISOString();
        const exportData = {
            timestamp: downloadTimestamp,
            system_status: latestTelemetry.system_status,
            payload: {
                ...latestTelemetry.payload,
                propulsion_log: propulsionLog,
                cdm: latestCDM
            }
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `CDM_${downloadTimestamp.replace(/[:.]/g, '-')}.json`;
        link.click();
    };
}

// =====================
// Sidebar Functionality
// =====================
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarItems = document.querySelectorAll('.sidebar-item');
const sections = document.querySelectorAll('.dashboard-section');
const dashboardContainer = document.querySelector('.dashboard-container');

if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        dashboardContainer.classList.toggle('sidebar-collapsed');
        sidebarToggle.classList.toggle('active');
        
        // Force reflow
        sidebar.style.display = 'none';
        sidebar.offsetHeight; 
        sidebar.style.display = 'block';
    });
}

sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
        sidebarItems.forEach(i => i.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));
        item.classList.add('active');
        const sectionId = item.getAttribute('data-section') + '-section';
        const section = document.getElementById(sectionId);
        if (section) section.classList.add('active');
    });
});
