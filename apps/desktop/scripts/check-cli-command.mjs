// The real-app check of "Install the ajour command from Settings" on Windows
// (#568, spec #567): the real desktop app installs a real `ajour` from a
// local fake release, puts its folder on the real user Path, and a fresh
// PowerShell that reads the new Path runs `ajour -V`.
//
// It starts the real app through `lifecycle-check/main.cjs` with a temp user
// data folder, a temp install folder (AJOUR_CLI_INSTALL_DIR) and a local
// release origin, which only an unpackaged app honours
// (AJOUR_CLI_RELEASE_ORIGIN). It asks the app its version (Electron's, for
// an app started from a script), builds the CLI archive of that version with
// the CLI's release scripts, serves it as that release's asset, and then:
//
// 1. reads the command's state through the window's bridge: not installed;
// 2. presses Install through the bridge, as the Settings row does, and waits
//    for it to end installed, with the app's version;
// 3. checks the user Path: the folder appended once, every other entry and
//    %VAR% as it was, the original registry type;
// 4. runs `ajour -V` in a fresh PowerShell whose Path is read from the
//    registry, as a new terminal's is;
// 5. installs again: the Path keeps one entry.
//
// The user Path is real. A backup records the original value and the check's
// proposed write. Cleanup restores the exact snapshot only if that write is
// still current. Otherwise it removes only the check folder and preserves
// concurrent changes. The backup is deleted only after verification.
//
//   corepack pnpm --filter @ajour/desktop check:cli-command
//   corepack pnpm --filter @ajour/desktop check:cli-command --skip-build
//
// --skip-build reuses the last renderer build (apps/web/dist-desktop) and the
// last CLI archive of the app's version (apps/cli/out/archives). --keep keeps the temp folder.
// CI runs it on Windows and macOS (`.github/workflows/desktop-lifecycle.yml`). Exits 1
// when anything fails.
import { execFile, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  lstat,
  readlink,
  access,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(desktopRoot, "../..");
const cliRoot = path.join(repoRoot, "apps", "cli");
const { _electron } = require(
  require.resolve("playwright", { paths: [repoRoot] }),
);

if (!["win32", "darwin"].includes(process.platform)) {
  process.stdout.write("check:cli-command runs on Windows and macOS.\n");
  process.exit(0);
}

const checkMain = path.join(desktopRoot, "lifecycle-check", "main.cjs");
const systemRoot = process.env.SystemRoot || "C:\\Windows";
const powershell = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const INSTALL_TIMEOUT_MS = 180_000;
/** The user Path as a run found it, kept until that run put it back. */
const PATH_BACKUP = path.join(os.tmpdir(), "ajour-check-cli-command-path.json");

const failures = [];
function expect(condition, message, detail) {
  process.stdout.write(`${condition ? "ok  " : "FAIL"} ${message}\n`);
  if (!condition) {
    failures.push(message);
    if (detail !== undefined) {
      process.stdout.write(
        `     ${JSON.stringify(detail, null, 1).replace(/\n/g, "\n     ")}\n`,
      );
    }
  }
  return condition;
}

const run = promisify(execFile);

/** Runs a PowerShell script, values passed through `env` only. */
async function powershellRun(script, env = {}, { path: pathValue } = {}) {
  const merged = { ...process.env, ...env };
  const { stdout } = await run(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: pathValue === undefined ? merged : withPath(merged, pathValue),
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return stdout;
}

const fromB64 = (text) => Buffer.from(text, "base64").toString("utf8");

/** The user Path, raw and with its kind, or null when there is none. */
async function readUserPath() {
  const answer = JSON.parse(
    await powershellRun(
      [
        "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment');",
        "$value = if ($key) { $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames') } else { $null };",
        "if ($null -eq $value) { '{}' } else {",
        "ConvertTo-Json -Compress -InputObject @{ kind = $key.GetValueKind('Path').ToString();",
        "value = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)) } }",
      ].join(" "),
    ),
  );
  return typeof answer.value === "string"
    ? { kind: answer.kind, value: fromB64(answer.value) }
    : null;
}

const {
  createPowerShellRegistry,
  pathWithFolder,
  checkPathRestoration,
} = require("../electron/cli-path.cjs");
const { codesignVerifyArgs } = require("../electron/cli-signature.cjs");
const registry = createPowerShellRegistry();

const samePath = (left, right) =>
  (left?.value ?? null) === (right?.value ?? null) &&
  (left?.kind ?? null) === (right?.kind ?? null);

/** Restore only the check's own edit, with a fresh conditional registry write. */
async function restoreBackup({ path: saved, installDir, written }) {
  const expectedWrite =
    written ??
    pathWithFolder(saved?.value, installDir, process.env, saved?.kind) ??
    saved?.value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readUserPath();
    const target = checkPathRestoration(
      current,
      saved,
      expectedWrite,
      installDir,
    );
    if (!samePath(current, target)) {
      if (
        !(await registry.write({
          expected: current?.value ?? null,
          expectedKind: current?.kind ?? null,
          value: target?.value ?? null,
          kind: target?.kind ?? null,
        }))
      )
        continue;
      await registry.broadcast().catch(() => undefined);
    }
    if (samePath(await readUserPath(), target)) {
      await rm(PATH_BACKUP, { force: true });
      return;
    }
  }
  throw new Error(
    `The check's PATH edit could not be removed. Backup: ${PATH_BACKUP}`,
  );
}

/** Saves the user Path and the run's install folder before anything changes. */
async function saveBackup(saved, installDir) {
  const temporary = `${PATH_BACKUP}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({
      path: saved,
      installDir,
      written:
        pathWithFolder(saved?.value, installDir, process.env, saved?.kind) ??
        saved?.value,
    }),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await rename(temporary, PATH_BACKUP);
}

/**
 * Puts back the user Path an earlier run cut short left changed: the exact
 * value and kind only while its own write is still current. A
 * Path without it was put back already, or changed by hand since, and is
 * left as it is. Throws when the Path can't be put back, so nothing runs.
 */
async function restoreLeftoverBackup() {
  if (!existsSync(PATH_BACKUP)) return;
  await restoreBackup(JSON.parse(readFileSync(PATH_BACKUP, "utf8")));
}

/** A port nothing listens on, never Ajour's 8787. */
async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port: chosen } = server.address();
        server.close(() => resolve(chosen));
      });
    });
    if (port !== 8787) return port;
  }
}

/** `env` with its Path, under whichever case it has, set to `value`. */
function withPath(env, value) {
  const rest = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"),
  );
  return { ...rest, [process.platform === "win32" ? "Path" : "PATH"]: value };
}

function runNode(script, env = {}) {
  const inherited = Object.entries(process.env).find(
    ([key]) => key.toLowerCase() === "path",
  )?.[1];
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    // The system's tar, as the release runner's shell finds it first.
    env: withPath(
      { ...process.env, ...env },
      process.platform === "win32"
        ? `${path.join(systemRoot, "System32")};${inherited ?? ""}`
        : (inherited ?? ""),
    ),
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(script)} failed with ${result.status}.`);
  }
}

/** The CLI archive of `release`, as the release workflow builds it. */
function buildCliArchive(release) {
  process.stdout.write(`Building ${release.asset}…\n`);
  for (const script of ["bundle.mjs", "sea.mjs", "archive.mjs"]) {
    runNode(path.join(cliRoot, "scripts", script), {
      RELEASE_TAG: release.tag,
    });
  }
}

/** The release of `version`: its tag, asset and archive. */
function releaseOf(version) {
  const asset = `ajour-${version}-${process.platform === "darwin" ? "macos" : "windows"}-${process.arch}.${process.platform === "darwin" ? "tar.gz" : "zip"}`;
  return {
    tag: `v${version}`,
    asset,
    archivePath: path.join(cliRoot, "out", "archives", asset),
  };
}

function buildRenderer(baseUrl) {
  process.stdout.write(`Building the renderer for ${baseUrl}…\n`);
  const result = spawnSync(
    process.execPath,
    [path.join(desktopRoot, "scripts", "run-renderer.cjs"), "build"],
    {
      cwd: desktopRoot,
      env: { ...process.env, VITE_APP_API_BASE_URL: baseUrl },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  if (result.status !== 0) {
    throw new Error(`The renderer build failed with ${result.status}.`);
  }
}

/**
 * A release origin that answers as GitHub does: the release `serve` gives,
 * with the asset's digest and size, and its download through a redirect.
 * Until then it has no release.
 */
async function serveRelease() {
  let served = null;
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (!served) {
      response.writeHead(404);
      response.end();
      return;
    }
    const { tag, asset, bytes, digest, missing } = served;
    const linuxAsset = `ajour-${tag.slice(1)}-linux-x64.tar.gz`;
    const linuxPath = path.join(
      process.env.AJOUR_CLI_CHECK_LINUX_ARCHIVES || "",
      linuxAsset,
    );
    const linuxBytes =
      process.env.AJOUR_CLI_CHECK_LINUX_ARCHIVES && existsSync(linuxPath)
        ? readFileSync(linuxPath)
        : null;
    const linuxReleasePage = `/les-cabochons/ajour/releases/download/${tag}/${linuxAsset}`;
    const origin = `http://127.0.0.1:${server.address().port}`;
    const releasePage = `/les-cabochons/ajour/releases/download/${tag}/${asset}`;
    if (request.url === `/repos/les-cabochons/ajour/releases/tags/${tag}`) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          tag_name: tag,
          assets: missing
            ? []
            : [
                ...(linuxBytes
                  ? [
                      {
                        name: linuxAsset,
                        size: linuxBytes.length,
                        digest: `sha256:${createHash("sha256").update(linuxBytes).digest("hex")}`,
                        browser_download_url: `${origin}${linuxReleasePage}`,
                      },
                    ]
                  : []),
                {
                  name: asset,
                  size: bytes.byteLength,
                  digest: `sha256:${digest}`,
                  browser_download_url: `${origin}${releasePage}`,
                },
              ],
        }),
      );
    } else if (linuxBytes && request.url === linuxReleasePage) {
      response.writeHead(200, { "Content-Length": linuxBytes.length });
      response.end(linuxBytes);
    } else if (request.url === releasePage) {
      // GitHub redirects a download to its asset host.
      response.writeHead(302, { Location: `${origin}/assets/${asset}` });
      response.end();
    } else if (request.url === `/assets/${asset}`) {
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": bytes.byteLength,
      });
      response.end(bytes);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    serve(release, bytes, missing = false) {
      served = {
        ...release,
        missing,
        bytes,
        digest: createHash("sha256").update(bytes).digest("hex"),
      };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * CI opts into its disposable Ubuntu; local runs never enter a user's
 * distro. The Linux ajour can't start in WSL 1 (#611), and GitHub's Windows
 * runners only run WSL 1: there the check proves the refusal. On a WSL 2
 * distro it runs Add end to end.
 */
async function checkWsl(page, version, baseUrl, { events, installDir }) {
  const distro = process.env.AJOUR_CLI_CHECK_WSL_DISTRO;
  if (!distro) {
    process.stdout.write(
      "SKIP WSL: no disposable distro configured. The user's Ubuntu and .wslconfig are untouched.\n",
    );
    return;
  }
  if (process.env.CI !== "true")
    throw new Error("WSL check requires CI's disposable distro.");
  const wsl = path.join(systemRoot, "System32", "wsl.exe");
  const inWsl = (program, args) =>
    run(wsl, ["-d", distro, "--exec", program, ...args], {
      timeout: 60_000,
      windowsHide: true,
    }).catch((error) => {
      // Its exit and output, never its arguments: one is the check's token.
      throw new Error(
        `\`${program}\` in ${distro} failed with ${error.code}: ${String(
          error.stderr || error.stdout || "",
        )
          .trim()
          .slice(0, 800)}`,
      );
    });
  const listed = (
    await page.evaluate(() => window.ajourDesktop.getCliCommand())
  ).wsl?.distros.find((row) => row.name === distro);
  if (listed?.version === 1) {
    process.stdout.write(
      `WSL 1 path: ${distro} runs on WSL 1, so the check proves Add's refusal (#611).\n`,
    );
    await checkWsl1Refusal(page, { distro, events, installDir, inWsl, listed });
    return;
  }
  if (listed?.version !== 2)
    throw new Error(`${distro} isn't in Settings' WSL rows.`);
  process.stdout.write(
    `WSL 2 path: ${distro} runs on WSL 2, so the check runs Add end to end.\n`,
  );
  const added = await page.evaluate(
    (distro) => window.ajourDesktop.addCliCommandWsl({ distro }),
    distro,
  );
  expect(
    added.wsl?.distros.find((row) => row.name === distro)?.status === "added",
    "Add installs the Linux command in Ubuntu",
    added,
  );
  const printed = await inWsl("bash", ["-lc", "ajour -V"]);
  expect(
    printed.stdout.trim() === `ajour ${version}`,
    "a new Ubuntu login shell runs ajour -V",
  );
  const token = await page.evaluate(async (api) => {
    const post = async (route, body) => {
      const response = await fetch(`${api}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`MCP setup failed: ${response.status}`);
      return response.json();
    };
    await post("/api/mcp/settings", { enabled: true });
    return (await post("/api/mcp/clients", { name: "WSL check" })).token;
  }, baseUrl);
  if (!token) throw new Error("No WSL check token.");
  // The app reads the MCP setting at launch: a reload opens the bridge.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  // The token is a short-lived fixture. Passing it as an argument avoids shell interpolation.
  const ajourStatus = () =>
    inWsl("bash", [
      "-lc",
      'export AJOUR_URL="$1" AJOUR_TOKEN="$2"; ajour status',
      "sh",
      baseUrl,
      token,
    ]);
  // The window answers once its bridge is open.
  let status;
  for (const deadline = Date.now() + 30_000; ;) {
    try {
      status = await ajourStatus();
      break;
    } catch (error) {
      if (
        Date.now() > deadline ||
        !String(error.message).includes("Open the Ajour window")
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  expect(
    status.stdout.trim().length > 0,
    "ajour status reaches the real app through the relay",
  );
  await inWsl("sh", [
    "-c",
    'rm "$HOME/.local/bin/ajour"; printf foreign > "$HOME/.local/bin/ajour"',
  ]);
  // Re-Add must still refuse a foreign replacement of a recorded link.
  const refused = await page.evaluate(
    (distro) => window.ajourDesktop.addCliCommandWsl({ distro }),
    distro,
  );
  expect(
    refused.wsl?.distros.find((row) => row.name === distro)?.error ===
      `Another ajour is at ~/.local/bin/ajour in ${distro}. Remove it, then add again.`,
    "Add refuses a foreign Ubuntu command",
  );
  await inWsl("sh", [
    "-c",
    'test "$(cat "$HOME/.local/bin/ajour")" = foreign && rm "$HOME/.local/bin/ajour"',
  ]);
}

/**
 * A WSL 1 distro (#611): its row says how to convert it, and Add is refused
 * with `wsl1_unsupported`, leaving the distro's `~/.local/bin` and Ajour's
 * `bin\linux` as they were.
 */
async function checkWsl1Refusal(
  page,
  { distro, events, installDir, inWsl, listed },
) {
  const sentence = `WSL 1 isn't supported. Convert it with: wsl --set-version ${distro} 2`;
  expect(
    listed.status === "unsupported" && listed.reason === sentence,
    "a WSL 1 Ubuntu's row says how to convert it",
    listed,
  );
  // `~/.local/bin`'s entries, or that it's absent.
  const localBin = async () =>
    (
      await inWsl("sh", [
        "-c",
        'if [ -d "$HOME/.local/bin" ]; then ls -la "$HOME/.local/bin"; else echo absent; fi',
      ])
    ).stdout;
  const linux = path.join(installDir, "linux");
  const before = { localBin: await localBin(), linux: existsSync(linux) };
  const refused = await page.evaluate(
    (distro) => window.ajourDesktop.addCliCommandWsl({ distro }),
    distro,
  );
  const row = refused.wsl?.distros.find(
    (candidate) => candidate.name === distro,
  );
  // Main prints the event on stdout as the call ends.
  let event;
  for (const deadline = Date.now() + 5_000; !event && Date.now() < deadline;) {
    event = events.find(
      (candidate) => candidate.name === "cli_command.wsl_add",
    );
    if (!event) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(
    row?.status === "unsupported" &&
      row.reason === sentence &&
      event?.outcome === "refused" &&
      event.outcome_reason === "wsl1_unsupported" &&
      !JSON.stringify(event).includes(distro),
    "Add refuses a WSL 1 Ubuntu with wsl1_unsupported",
    { row, event },
  );
  const after = { localBin: await localBin(), linux: existsSync(linux) };
  expect(
    JSON.stringify(after) === JSON.stringify(before) && !after.linux,
    "the refusal leaves ~/.local/bin and bin\\linux untouched",
    { before, after },
  );
}

/** Restart version A as B, first without B's asset, then publish it. */
async function checkFollow(electronApp, env, release, version, binary) {
  await electronApp.close();
  const nextVersion = "0.0.2";
  if (version === nextVersion)
    throw new Error("Follow fixture versions must differ.");
  const next = releaseOf(nextVersion);
  buildCliArchive(next);
  // B's release metadata is present but its asset is absent.
  release.serve(next, readFileSync(next.archivePath), true);
  const app = await _electron.launch({
    args: [checkMain],
    cwd: desktopRoot,
    env: {
      ...env,
      AJOUR_CLI_CHECK_VERSION: nextVersion,
      AJOUR_CLI_FOLLOW_RETRY_MS: "1000",
    },
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    expect(
      (await app.evaluate(({ app }) => app.getVersion())) === nextVersion,
      "the restarted app runs as version B",
    );
    const waitForState = async (status) => {
      const deadline = Date.now() + INSTALL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const state = await page.evaluate(() =>
          window.ajourDesktop.getCliCommand(),
        );
        if (
          state.status === status &&
          (status === "error" ? state.pending : state.version) === nextVersion
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Follow did not reach ${status}.`);
    };
    await waitForState("error");
    expect(
      (await run(binary, ["-V"])).stdout.trim() === `ajour ${version}`,
      "follow missing asset keeps version A working",
    );
    release.serve(next, readFileSync(next.archivePath));
    await waitForState("installed");
    const printed = (await run(binary, ["-V"])).stdout.trim();
    expect(
      printed === `ajour ${nextVersion}`,
      "follow retry picks up version B without another restart and ajour -V prints B",
      {
        printed,
        state: await page.evaluate(() => window.ajourDesktop.getCliCommand()),
      },
    );
    const pathBeforeRemove =
      process.platform === "win32" ? await readUserPath() : null;
    const removed = await page.evaluate(() =>
      window.ajourDesktop.removeCliCommand(),
    );
    expect(
      removed.status === "not-installed",
      "Remove ends Not installed",
      removed,
    );
    const folder = env.AJOUR_CLI_INSTALL_DIR;
    // With the Linux build for WSL, when the check added it.
    expect(!existsSync(folder), "Remove deletes the install folder");
    expect(
      !existsSync(path.join(env.AJOUR_USER_DATA_PATH, "cli-command.json")),
      "Remove deletes the record",
    );
    if (process.platform === "darwin") {
      expect(
        !(await lstat("/usr/local/bin/ajour").catch(() => null)),
        "Remove deletes the macOS command link",
      );
    } else {
      const after = await readUserPath();
      expect(
        after?.kind === pathBeforeRemove?.kind &&
          after?.value ===
            (pathBeforeRemove?.value ?? "")
              .split(";")
              .filter((entry) => entry !== folder)
              .join(";"),
        "Remove preserves the other Path entries and registry type",
      );
      // Install trims trailing separators when appending. After Remove, the
      // check's own expected write is that projection, not the appended Path.
      // Derive it from the saved write so concurrent entries still prevent
      // restoring the snapshot, just as they did before Remove existed.
      const backup = JSON.parse(readFileSync(PATH_BACKUP, "utf8"));
      backup.written = backup.written
        .split(";")
        .filter((entry) => entry !== folder)
        .join(";");
      await writeFile(`${PATH_BACKUP}.tmp`, JSON.stringify(backup), {
        mode: 0o600,
      });
      await rename(`${PATH_BACKUP}.tmp`, PATH_BACKUP);
    }
  } finally {
    await app.close();
  }
}

const entriesOf = (value) =>
  (value ?? "").split(";").filter((entry) => entry.trim() !== "");

async function main() {
  // Before anything else: a Path an earlier run left changed goes back.
  await restoreLeftoverBackup();

  const skipBuild = process.argv.includes("--skip-build");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  if (!skipBuild) buildRenderer(baseUrl);

  const release = await serveRelease();
  const temp = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-command-"));
  const installDir = path.join(temp, "Local", "Ajour", "bin");

  // The real user Path: read and saved before anything can change it.
  const before = await readUserPath();
  await saveBackup(before, installDir);
  process.stdout.write(
    `     user Path before: ${before ? `${before.kind}, ${before.value.length} characters` : "none"}\n`,
  );

  const env = {
    ...process.env,
    AJOUR_USER_DATA_PATH: path.join(temp, "user-data"),
    AJOUR_APP_API_PORT: String(port),
    AJOUR_CLI_RELEASE_ORIGIN: release.origin,
    AJOUR_CLI_INSTALL_DIR: installDir,
    AJOUR_WIDE_EVENTS: "console",
    AJOUR_CLI_CHECK_VERSION: process.env.AJOUR_CLI_CHECK_VERSION || "0.0.1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AJOUR_DESKTOP_RENDERER_URL;
  delete env.ELECTRON_DISABLE_SANDBOX;

  let electronApp;
  const events = [];
  let stderr = "";
  try {
    electronApp = await _electron.launch({
      args: [checkMain],
      cwd: desktopRoot,
      env,
      timeout: 60_000,
    });
    const mainProcess = electronApp.process();
    mainProcess.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    let buffered = "";
    mainProcess.stdout?.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (
            typeof event?.name === "string" &&
            event.name.startsWith("cli_command.")
          ) {
            events.push(event);
          }
        } catch {
          // Not an event.
        }
      }
    });

    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // The release of the app's own version, built as the release builds it.
    const appVersion = await electronApp.evaluate(({ app }) =>
      app.getVersion(),
    );
    const { tag, asset, archivePath } = releaseOf(appVersion);
    if (!skipBuild || !existsSync(archivePath)) {
      buildCliArchive(releaseOf(appVersion));
    }
    release.serve({ tag, asset }, readFileSync(archivePath));

    // 1. Not installed, read through the bridge Settings uses.
    const initial = await page.evaluate(() =>
      window.ajourDesktop.getCliCommand(),
    );
    expect(
      initial.status === "not-installed",
      "the command reads as not installed in a fresh profile",
      initial,
    );

    // 2. Install, as the Settings row's button does.
    const installed = await page.evaluate(
      (timeout) =>
        Promise.race([
          window.ajourDesktop.installCliCommand(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Install timed out.")), timeout),
          ),
        ]),
      INSTALL_TIMEOUT_MS,
    );
    expect(
      installed.status === "installed" &&
        installed.version === appVersion &&
        installed.location === installDir &&
        installed.newlyInstalled === true,
      `Install ends installed, with ajour ${appVersion} in the install folder`,
      installed,
    );
    expect(
      release.requests.includes(`/assets/${asset}`),
      "it downloaded the archive through the release's redirect",
      release.requests,
    );
    const files = (await readdir(installDir, { recursive: true })).map((name) =>
      name.replaceAll("\\", "/"),
    );
    expect(
      files.includes("ajour.exe") &&
        files.some((name) => name.startsWith("share/completions/")) &&
        !files.some((name) => /\.old-|\.staging-/.test(name)),
      "the install folder holds ajour.exe and its completions, and nothing left over",
      files,
    );
    const record = path.join(temp, "user-data", "cli-command.json");
    expect(
      (await stat(record).catch(() => null))?.isFile() === true,
      "the record is in the user data folder",
    );

    // 3. The user Path: our folder appended once, the rest as it was.
    const after = await readUserPath();
    const expectedEntries = [...entriesOf(before?.value), installDir];
    expect(
      after?.kind === (before?.kind ?? "ExpandString") &&
        JSON.stringify(entriesOf(after.value)) ===
          JSON.stringify(expectedEntries),
      "the user Path gains the folder, keeps every other entry unexpanded, and preserves its registry type",
      { kind: after?.kind, added: entriesOf(after?.value).slice(-2) },
    );

    // 4. A new terminal: a fresh PowerShell whose Path comes from the registry.
    const fresh = await powershellRun(
      [
        "$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User');",
        "$found = Get-Command ajour -CommandType Application | Select-Object -First 1;",
        "[Console]::Out.WriteLine($found.Source);",
        "& ajour -V",
      ].join(" "),
      { AJOUR_URL: "", AJOUR_TOKEN: "" },
      // Nothing of this process's Path, which never saw the change.
      { path: path.join(systemRoot, "System32") },
    ).catch((error) => `failed: ${error.message}`);
    const [found, printed] = fresh.trim().split(/\r?\n/);
    expect(
      found?.toLowerCase() ===
        path.join(installDir, "ajour.exe").toLowerCase() &&
        printed === `ajour ${appVersion}`,
      `a new terminal finds ajour on its Path and \`ajour -V\` prints "ajour ${appVersion}"`,
      { found, printed },
    );

    // 5. A second install keeps one entry.
    const again = await page.evaluate(() =>
      window.ajourDesktop.installCliCommand(),
    );
    const twice = await readUserPath();
    expect(
      again.status === "installed" &&
        entriesOf(twice?.value).filter(
          (entry) => entry.toLowerCase() === installDir.toLowerCase(),
        ).length === 1,
      "a second install leaves one entry on the Path",
      { status: again.status, error: again.error },
    );

    const install = events.filter(
      (event) => event.name === "cli_command.install",
    );
    expect(
      install.length === 2 &&
        install.every((event) => event.outcome === "ok") &&
        install[0].cli_command?.path_added === true &&
        install[1].cli_command?.path_added === false &&
        !JSON.stringify(install).includes(os.userInfo().username),
      "each install emits cli_command.install, ok, without the user name",
      install.map((event) => ({
        outcome: event.outcome,
        cli_command: event.cli_command,
      })),
    );
    await checkWsl(page, appVersion, `http://127.0.0.1:${port}`, {
      events,
      installDir,
    });
    await checkFollow(
      electronApp,
      env,
      release,
      appVersion,
      path.join(installDir, "ajour.exe"),
    );
    electronApp = undefined;
  } catch (error) {
    expect(false, `the check ran to the end: ${error.message}`, {
      stderr: stderr.slice(-1_500),
    });
  } finally {
    await electronApp?.close().catch(() => undefined);
    await release.close();
    // Always put the developer's Path back, then prove it.
    try {
      await restoreLeftoverBackup();
      const restored = await readUserPath();
      if (
        expect(
          samePath(restored, before),
          "the user Path is restored byte for byte, with its kind",
          { before: before?.kind, after: restored?.kind },
        )
      ) {
        await rm(PATH_BACKUP, { force: true });
      }
    } catch (error) {
      expect(false, `the user Path was restored: ${error.message}`);
    }
    if (existsSync(PATH_BACKUP)) {
      process.stdout.write(
        `     The user Path is saved in ${PATH_BACKUP}; the next run puts it back first.\n`,
      );
    }
    if (process.argv.includes("--keep")) {
      process.stdout.write(`     temp folder kept in ${temp}\n`);
    } else {
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} check(s) failed.\n`);
    process.exit(1);
  }
  process.stdout.write(
    "\nThe ajour command installs from Settings on Windows.\n",
  );
}

// A durable ownership marker lets the next macOS run clean up a cut-short check.
const LINK_BACKUP = path.join(os.tmpdir(), "ajour-check-cli-command-link.json");
const LINK = "/usr/local/bin/ajour";
async function cleanMacBackup() {
  if (!existsSync(LINK_BACKUP)) return;
  const saved = JSON.parse(readFileSync(LINK_BACKUP, "utf8"));
  if (
    typeof saved.temp !== "string" ||
    path.dirname(saved.temp) !== os.tmpdir() ||
    !path.basename(saved.temp).startsWith("ajour-cli-command-") ||
    saved.binary !==
      path.join(saved.temp, "Application Support", "Ajour", "bin", "ajour")
  )
    throw new Error("Invalid check cleanup folder.");

  const entry = await lstat(LINK).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (entry?.isSymbolicLink() && (await readlink(LINK)) === saved.binary)
    await rm(LINK);
  else if (
    entry?.isFile() &&
    entry.size === Buffer.byteLength(saved.sentinel) &&
    readFileSync(LINK, "utf8") === saved.sentinel
  )
    await rm(LINK);
  else if (entry)
    throw new Error(
      "A foreign ajour replaced the check's link. It was left untouched.",
    );
  await rm(saved.temp, { recursive: true, force: true });
  await rm(LINK_BACKUP);
}
async function macMain() {
  await cleanMacBackup();
  // Never change an existing developer command, even a broken symlink.
  if (
    await lstat(LINK).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    })
  )
    throw new Error(
      "The check requires an absent /usr/local/bin/ajour. Existing command left untouched.",
    );
  await access("/usr/local/bin", 2);
  const temp = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-command-"));
  const installDir = path.join(temp, "Application Support", "Ajour", "bin");
  const binary = path.join(installDir, "ajour");
  const sentinel = `ajour check foreign file ${randomUUID()}\n`;
  await writeFile(
    `${LINK_BACKUP}.tmp`,
    JSON.stringify({ binary, sentinel, temp }),
    { mode: 0o600 },
  );
  await rename(`${LINK_BACKUP}.tmp`, LINK_BACKUP);
  const port = await freePort();
  const release = await serveRelease();
  let electronApp;
  try {
    if (!process.argv.includes("--skip-build"))
      buildRenderer(`http://127.0.0.1:${port}`);
    const env = {
      ...process.env,
      AJOUR_USER_DATA_PATH: path.join(temp, "user-data"),
      AJOUR_APP_API_PORT: String(port),
      AJOUR_CLI_RELEASE_ORIGIN: release.origin,
      AJOUR_CLI_INSTALL_DIR: installDir,
      AJOUR_CLI_ADHOC_SIGNATURE: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.AJOUR_DESKTOP_RENDERER_URL;
    delete env.ELECTRON_DISABLE_SANDBOX;
    electronApp = await _electron.launch({
      args: [checkMain],
      cwd: desktopRoot,
      env,
      timeout: 60_000,
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const version = await electronApp.evaluate(({ app }) => app.getVersion());
    const artifact = releaseOf(version);
    // sea.mjs signs the injected Mach-O with the job's ad-hoc identity.
    buildCliArchive(artifact);
    release.serve(artifact, readFileSync(artifact.archivePath));
    expect(
      (await page.evaluate(() => window.ajourDesktop.getCliCommand()))
        .status === "not-installed",
      "fresh macOS profile is not installed",
    );
    await writeFile(LINK, sentinel, { flag: "wx" });
    const refused = await page.evaluate(() =>
      window.ajourDesktop.installCliCommand(),
    );
    expect(
      refused.status === "error" &&
        refused.error ===
          "Another ajour is at /usr/local/bin/ajour. Remove it, then press Retry in Settings.",
      "foreign file is refused",
      refused,
    );
    expect(
      readFileSync(LINK, "utf8") === sentinel,
      "foreign file stays untouched",
    );
    await rm(LINK);
    const installed = await page.evaluate(() =>
      window.ajourDesktop.installCliCommand(),
    );
    expect(
      installed.status === "installed" && installed.location === LINK,
      "Settings installs through the macOS link",
      installed,
    );
    expect(
      (await readlink(LINK)) === binary,
      "link points to the check's binary",
    );
    const { stdout } = await run(LINK, ["-V"], { timeout: 10_000 });
    expect(
      stdout.trim() === `ajour ${version}`,
      "ajour -V runs through /usr/local/bin/ajour",
      stdout,
    );
    await run("/usr/bin/codesign", ["--verify", "--strict", binary]);
    // Releases are checked against the team requirement, which an ad-hoc
    // build fails with exit 3. Any other exit means codesign couldn't read it.
    const requirement = await run(
      "/usr/bin/codesign",
      codesignVerifyArgs(binary),
    ).then(
      () => 0,
      (error) => error.code,
    );
    expect(
      requirement === 3,
      "codesign reads the release requirement and refuses the ad-hoc build",
      requirement,
    );
    await checkFollow(electronApp, env, release, version, LINK);
    electronApp = undefined;
  } finally {
    await electronApp?.close().catch(() => undefined);
    await release.close();
    await cleanMacBackup();
    expect(
      !(await lstat(LINK).catch(() => null)),
      "the check leaves no link or foreign fixture",
    );
    await rm(temp, { recursive: true, force: true });
    expect(
      !existsSync(temp) && !existsSync(LINK_BACKUP),
      "the check leaves no install or ownership marker",
    );
  }
  if (failures.length)
    throw new Error(`${failures.length} macOS CLI checks failed.`);
}
if (process.platform === "darwin") await macMain();
else await main();
