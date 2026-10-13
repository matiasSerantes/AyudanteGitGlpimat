chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Serialize read/modify/write to preserve messages from both panel and page.
const LOG_KEY = "smartCentralDiagnostics";
const LOG_LIMIT = 1500;
let logWrites = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "diagnostics.append") return;
  const entry = message.entry || {};
  logWrites = logWrites.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(LOG_KEY);
    const entries = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
    entries.push({ timestamp: new Date().toISOString(), version: chrome.runtime.getManifest().version,
      level: String(entry.level || "info").slice(0, 20), event: String(entry.event || "unknown").slice(0, 100),
      source: String(entry.source || "unknown").slice(0, 30), tabId: sender.tab?.id,
      details: JSON.parse(JSON.stringify(entry.details || {}, (_key, value) => typeof value === "string" ? value.slice(0, 2000) : value)) });
    await chrome.storage.local.set({ [LOG_KEY]: entries.slice(-LOG_LIMIT) });
  });
  logWrites.then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});
