import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, "out");
await mkdir(out, { recursive: true });
const run = (file, args) => execFileSync(file, args, { stdio: "inherit" });
const binary = path.join(
  out,
  process.platform === "win32" ? "ajour.exe" : "ajour",
);
const blob = path.join(out, "sea.blob");
const config = path.join(out, "sea-config.json");
await writeFile(
  config,
  JSON.stringify({
    main: path.join(root, "dist/ajour.cjs"),
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }),
);
run(process.execPath, ["--experimental-sea-config", config]);
await copyFile(process.execPath, binary);
if (process.platform === "darwin")
  run("codesign", ["--remove-signature", binary]);
const require = createRequire(import.meta.url);
const { inject } = require("postject");
const { readFile } = await import("node:fs/promises");
await inject(binary, "NODE_SEA_BLOB", await readFile(blob), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
});
if (process.platform === "darwin") run("codesign", ["--sign", "-", binary]);
run(binary, ["-V"]);
