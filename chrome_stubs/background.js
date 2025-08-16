
// background.js

console.log("[ROVAS Background] Service Worker started.");

// Listener to capture changeset ID by OSM API request
chrome.webRequest.onCompleted.addListener(
  function(details) {
    const url = new URL(details.url);
    const match = url.pathname.match(/\/changeset\/(\d+)\/(upload|close)/);

    if (match && match[1]) {
      const changesetId = match[1];
      console.log(`%c[ROVAS Background] ID Changeset Found: ${changesetId} from request: ${details.url}`, 'color: cyan; font-weight: bold;');

      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (
          tabs[0] &&
          (tabs[0].url.startsWith("https://www.openstreetmap.org/edit") ||
           tabs[0].url.startsWith("https://rapideditor.org/edit"))
        ) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: "CHANGESET_ID_DETECTED",
            changesetId: changesetId
          });
        }
      });
    }
  },
  { urls: ["https://api.openstreetmap.org/api/0.6/changeset/*"] }
);

// Fallback calculation
function calculateDuration() {
  const start = localStorage.getItem("sessionStart");
  const end = Date.now();
  if (!start) return 0;
  return Math.round((end - parseInt(start, 10)) / 60000);
}

function sendReportToRovas(durationMinutes) {
  const apiKey = localStorage.getItem("rovasApiKey");
  const token = localStorage.getItem("rovasToken");
  const changesetId = localStorage.getItem("changesetId") || "unknown";
  const comment = localStorage.getItem("changesetComment") || "No comment";

  if (!apiKey || !token) {
    console.error("Missing ROVAS API credentials.");
    return;
  }

  const payload = {
    duration: durationMinutes,
    changeset_id: changesetId,
    comment: comment
  };

  fetch("https://dev.rovas.app/api/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-API-KEY": apiKey
    },
    body: JSON.stringify(payload)
  })
  .then(response => response.json())
  .then(data => {
    console.log("✅ Report submitted:", data);
    chrome.storage.local.remove("manualDuration");
  })
  .catch(error => {
    console.error("❌ Error submitting report:", error);
  });
}

function handleSubmitReport() {
  chrome.storage.local.get(["manualDuration"], (result) => {
    const manual = result.manualDuration;
    const duration = manual && !isNaN(manual) ? Math.round(manual * 60) : calculateDuration();
    sendReportToRovas(duration);
  });
}
