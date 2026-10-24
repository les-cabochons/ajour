import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { TEST_WINDOW_ORIGIN } from "./test-support/window-token.ts";
import { WINDOW_TOKEN_HEADER } from "./window-token.ts";

const SERVER = fileURLToPath(new URL("./standalone.ts", import.meta.url));
const roots: string[] = [];
const stops: (() => void)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

/** Starts the standalone API on a free port, once it says where it listens. */
async function startStandalone(env: Record<string, string> = {}) {
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
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  stops.push(() => child.kill());
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => (output.stdout += chunk));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No listening line. stderr: ${output.stderr}`)),
      15_000,
    );
    child.stderr.on("data", (chunk) => {
      output.stderr += chunk;
      if (output.stderr.includes("listening on http://")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code) =>
      reject(
        new Error(`The API exited with ${code}. stderr: ${output.stderr}`),
      ),
    );
  });
  const port = /listening on http:\/\/[^:]+:(\d+)/u.exec(output.stderr)![1];
  return { output, baseUrl: `http://127.0.0.1:${port}` };
}

it("says where the standalone API listens on stderr, and keeps stdout for events", async () => {
  const { output } = await startStandalone();

  expect(output.stderr).toMatch(
    /Ajour app API listening on http:\/\/127\.0\.0\.1:\d+/,
  );
  expect(output.stdout).toBe("");
}, 20_000);

it("answers the window with the token it was started with, and never prints it", async () => {
  const windowToken = "standalone-window-token-canary-81d3";
  const { output, baseUrl } = await startStandalone({
    AJOUR_APP_API_WINDOW_TOKEN: windowToken,
    AJOUR_APP_API_ALLOWED_ORIGINS: TEST_WINDOW_ORIGIN,
  });

  const fromWindow = await fetch(`${baseUrl}/api/mcp/settings`, {
    headers: { [WINDOW_TOKEN_HEADER]: windowToken, Origin: TEST_WINDOW_ORIGIN },
  });
  const fromScript = await fetch(`${baseUrl}/api/mcp/settings`);

  expect(fromWindow.status).toBe(200);
  expect(fromScript.status).toBe(401);
  expect(output.stdout + output.stderr).not.toContain(windowToken);
  expect(output.stderr).not.toMatch(/No window token/u);
}, 20_000);

it("answers only /api/health when it was started without a token", async () => {
  const { output, baseUrl } = await startStandalone({
    AJOUR_APP_API_WINDOW_TOKEN: "",
  });

  const health = await fetch(`${baseUrl}/api/health`);
  const settings = await fetch(`${baseUrl}/api/mcp/settings`);

  expect(health.status).toBe(200);
  expect(settings.status).toBe(401);
  expect(output.stderr).toMatch(/No window token was given/u);
}, 20_000);
