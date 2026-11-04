import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const version =
  process.env.RELEASE_TAG?.replace(/^v/, "") ??
  JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
  throw new Error("Invalid release version");
const os = { win32: "windows", darwin: "macos", linux: "linux" }[
  process.platform
];
const name = `ajour-${version}-${os}-${process.arch}`;
const stage = path.join(root, "out", name);
await mkdir(stage, { recursive: true });
await cp(
  path.join(root, "out", process.platform === "win32" ? "ajour.exe" : "ajour"),
  path.join(stage, process.platform === "win32" ? "ajour.exe" : "ajour"),
);
// The manual generator (#540) owns these optional distribution directories.
for (const dir of ["man", "completions"]) {
  try {
    await readdir(path.join(root, "dist", dir));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  await cp(path.join(root, "dist", dir), path.join(stage, dir), {
    recursive: true,
  });
}
const artifacts = path.join(root, "out/archives");
await mkdir(artifacts, { recursive: true });
if (process.platform === "win32") {
  execFileSync(
    "tar",
    ["-a", "-cf", path.join(artifacts, `${name}.zip`), "-C", stage, "."],
    { stdio: "inherit" },
  );
} else {
  execFileSync(
    "tar",
    ["-czf", path.join(artifacts, `${name}.tar.gz`), "-C", stage, "."],
    { stdio: "inherit" },
  );
}
