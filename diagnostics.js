if (!globalThis.centralDiagnosticsLoaded) {
globalThis.centralDiagnosticsLoaded = true;
// Logging never blocks ticket operations, even if the extension was reloaded.
globalThis.centralLog = async (level, event, details = {}) => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "diagnostics.append", entry: {
      level, event, details, source: location.protocol === "chrome-extension:" ? "panel" : "central"
    }});
    if (!result?.ok) console.warn("No se pudo guardar el diagnostico", result?.error);
  } catch (error) { console.warn("No se pudo guardar el diagnostico", error); }
};
window.addEventListener("error", event => centralLog("error", "javascript.error", {
  message: String(event.message).slice(0, 1000), line: event.lineno, column: event.colno
}));
window.addEventListener("unhandledrejection", event => centralLog("error", "javascript.rejection", {
  message: String(event.reason?.message || event.reason).slice(0, 1000)
}));

}
