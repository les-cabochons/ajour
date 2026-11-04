import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const version =
  process.env.RELEASE_TAG?.replace(/^v/, "") ||
  JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
  throw new Error("Invalid release version");
const os = { win32: "windows", darwin: "macos", linux: "linux" }[
  process.platform
];
const name = `ajour-${version}-${os}-${process.arch}`;
const stage = path.join(root, "out", name);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(
  path.join(root, "out", process.platform === "win32" ? "ajour.exe" : "ajour"),
  path.join(stage, process.platform === "win32" ? "ajour.exe" : "ajour"),
);
// The CLI package build owns dist/man, including its man1 directory (#557).
try {
  await readdir(path.join(root, "dist/man"));
  await cp(path.join(root, "dist/man"), path.join(stage, "man"), {
    recursive: true,
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const binary = path.join(
  stage,
  process.platform === "win32" ? "ajour.exe" : "ajour",
);
for (const [shell, filename] of [
  ["bash", "ajour.bash"],
  ["zsh", "_ajour"],
  ["fish", "ajour.fish"],
]) {
  let output;
  try {
    output = execFileSync(binary, ["completion", shell], {
      encoding: "utf8",
      env: { ...process.env, AJOUR_URL: "", AJOUR_TOKEN: "" },
    });
  } catch (error) {
    // Older CLI versions do not have completion yet. Other errors must fail packaging.
    if (
      error.status === 2 &&
      /Unknown command "completion"|Unsupported shell|Unknown shell|completion takes /.test(
        String(error.stderr),
      )
    ) {
      process.stdout.write(`Skipping unsupported completion shell: ${shell}\n`);
      continue;
    }
    throw error;
  }
  await mkdir(path.join(stage, "completions"), { recursive: true });
  await writeFile(path.join(stage, "completions", filename), output);
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
