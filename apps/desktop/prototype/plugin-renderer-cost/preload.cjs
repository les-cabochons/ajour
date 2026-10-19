// PROTOTYPE (#230, #260). Throwaway, never merged.
// Sandboxed preload. It exposes exactly one function.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ajourHost", {
  invoke: (message) => ipcRenderer.invoke("ajour-ext:invoke", message),
});
