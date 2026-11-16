const fs = require("node:fs/promises");
function terminalSettings(platform, file) {
  const choices =
    platform === "win32" ? ["wt"] : platform === "darwin" ? ["Terminal"] : [];
  async function save(value) {
    if (!choices.includes(value)) throw new Error("Unsupported terminal app");
    await fs.writeFile(file, JSON.stringify(value));
    return value;
  }
  return {
    save,
    async read() {
      if (!choices.length) return undefined;
      try {
        const value = JSON.parse(await fs.readFile(file, "utf8"));
        if (choices.includes(value)) return value;
        if (
          (platform === "win32" && ["powershell", "cmd"].includes(value)) ||
          (platform === "darwin" && value === "iTerm")
        )
          return save(choices[0]);
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
          throw error;
      }
      return choices[0];
    },
  };
}
async function openPluginLink(given, declaredSchemes, openExternal) {
  const url = new URL(given);
  const scheme = url.protocol.slice(0, -1);
  // The API supplies the manifest schemes, never the requesting plugin renderer.
  if (
    scheme !== "https" &&
    (!/^[a-z][a-z0-9+.-]*$/.test(scheme) ||
      ["file", "http", "javascript", "data", "vbscript"].includes(scheme) ||
      !declaredSchemes.includes(scheme))
  )
    throw new Error("Unsupported plugin link scheme");
  if (url.username || url.password) throw new Error("Invalid plugin link");
  await openExternal(url.href);
}
module.exports = { terminalSettings, openPluginLink };
