import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const WEB_HOST = "127.0.0.1";
export const WEB_PORT = Number(process.env.AJOUR_QA_PORT ?? 4173);
export const BASE_URL = `http://${WEB_HOST}:${WEB_PORT}`;

async function isUp() {
  try {
    const response = await fetch(BASE_URL, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Uses the dev server on the QA port if one runs, else starts one in test
 * mode (no internal API: the scripts mock it) and returns how to stop it.
 */
export async function ensureServer() {
  if (await isUp()) return () => {};
  const child = spawn(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@ajour/web",
      "dev",
      "--host",
      WEB_HOST,
      "--port",
      String(WEB_PORT),
      "--strictPort",
      "--mode",
      "test",
    ],
    { cwd: repoRoot, stdio: "ignore", shell: process.platform === "win32" },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isUp()) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!(await isUp())) {
    child.kill();
    throw new Error(`The web app did not start on ${BASE_URL} within 60s.`);
  }
  return () => {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  };
}
