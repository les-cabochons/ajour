// Test-only packaged entrypoint for the official plugin release check
// (#403). Production releases never include these files.
const base = require("./electron-builder.config.cjs");
module.exports = {
  ...base,
  appId: "com.lescabochons.ajour.plugin-release-check",
  productName: "Ajour plugin release check",
  extraMetadata: {
    ...base.extraMetadata,
    main: "sandbox-check/official-plugins.cjs",
  },
  directories: { output: "out/plugin-release-check" },
  files: [
    ...base.files,
    "sandbox-check/official-plugins.cjs",
    "sandbox-check/official-plugins/*.cjs",
  ],
};
