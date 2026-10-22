import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const SERVER = fileURLToPath(new URL("./standalone.ts", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

it("says where the standalone API listens on stderr, and keeps stdout for events", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-api-cli-"));
  roots.push(root);
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", SERVER],
    {
      env: {
        ...process.env,
        AJOUR_APP_API_PORT: "0",
        AJOUR_APP_API_STATE_PATH: path.join(root, "state.json"),
        AJOUR_WIDE_EVENTS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No listening line. stderr: ${stderr}`)),
        15_000,
      );
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.includes("listening on http://")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) =>
        reject(new Error(`The API exited with ${code}. stderr: ${stderr}`)),
      );
    });
  } finally {
    child.kill();
  }

  expect(stderr).toMatch(
    /Ajour app API listening on http:\/\/127\.0\.0\.1:\d+/,
  );
  expect(stdout).toBe("");
}, 20_000);
