console.log("Extension service worker alive");

function openUDISE() {
  console.log("Opening UDISE now");
  chrome.tabs.create({ url: "https://udiseplus.gov.in/" }, (tab) => {
    console.log("[EduSphere Extension] UDISE tab created:", tab?.id);
    if (tab?.windowId) {
      chrome.windows.update(tab.windowId, { focused: true, state: "maximized" }, () => {
        console.log("Chrome window focused");
      });
    }
  });
}

chrome.action.onClicked.addListener(() => {
  console.log("[EduSphere Extension] Extension icon clicked");
  openUDISE();
});

// Poll the Tauri bridge server for OPEN_UDISE triggers
const BRIDGE_URL = "http://127.0.0.1:9876/poll";

setInterval(async () => {
  try {
    console.log("Polling EduSphere bridge");
    const res = await fetch(BRIDGE_URL);
    const data = await res.json();
    console.log(data);
    if (data && data.action === "OPEN_UDISE") {
      console.log("[EduSphere Extension] Received OPEN_UDISE from bridge");
      openUDISE();
    }
  } catch {
    // Bridge server not running yet — expected during startup
  }
}, 1000);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === "OPEN_UDISE") {
    openUDISE();
    sendResponse({ success: true });
  }
});
