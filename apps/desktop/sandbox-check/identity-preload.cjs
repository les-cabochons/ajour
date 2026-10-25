// The check's own preload, in every frame of its identity page: it asks main
// who the frame is, as plugin-renderer-policy.cjs tells it.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("identity", {
  who: () => ipcRenderer.invoke("ajour-check:identity"),
});
