// The preload of a plugin's hidden page, in its sandbox. It gives the page
// one function, `invoke`, and nothing else: the page relays its plugin
// worker's calls to Ajour's main process through it. Main knows the plugin
// from the sender, never from the message (plugin-renderer-policy.cjs).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ajourPlugin", {
  invoke: (message) => ipcRenderer.invoke("ajour:plugin-renderer", message),
});
