const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const { tagForPackageVersion } = require("./update-check.cjs");

/**
 * The ajour command, installed from Settings › General › Terminal (#568,
 * spec #567). One controller owns it: `state()`, `install()` and
 * `onChange()`. Every outside effect is a seam, so tests pass fakes and
 * main.cjs passes Electron's `net.fetch`, `node:fs/promises`, `execFile`
 * and cli-path.cjs.
 *
 * An install:
 *
 * 1. reads the release of the app's own version, `v<version>`, from the
 *    GitHub API, and this platform's asset, with its `digest` and `size`;
 * 2. downloads it from Ajour's release page, over HTTPS only, at most
 *    120 MB, hashing it as it streams to a staging folder in the install
 *    folder;
 * 3. lists and unpacks it with the system tar, by its absolute path, into a
 *    fresh folder, refusing any entry that would land outside it;
 * 4. checks that the unpacked binary prints `ajour <app version>` for `-V`;
 * 5. moves the files into the install folder, renaming what was there aside;
 * 6. puts the folder on the PATH;
 * 7. writes `cli-command.json` atomically, mode 0600.
 *
 * Any failure puts back what was installed before and removes what it made.
 * A refusal ends the install's event `refused` with its reason; anything
 * else ends it as an error.
 */

const GITHUB_REPOSITORY = "les-cabochons/ajour";
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_ORIGIN = "https://github.com";
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;
const LOOKUP_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const VERSION_CHECK_TIMEOUT_MS = 10_000;
const TAR_TIMEOUT_MS = 60_000;
const DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;
const MAX_REDIRECTS = 5;

const PLATFORM_NAMES = {
  win32: { os: "windows", label: "Windows", extension: "zip" },
  darwin: { os: "macos", label: "macOS", extension: "tar.gz" },
};

/** The release asset of `platform` and `arch`, or null where none ships. */
function cliAssetName(platform, arch, version) {
  const names = PLATFORM_NAMES[platform];
  return names
    ? `ajour-${version}-${names.os}-${arch}.${names.extension}`
    : null;
}

/** The binary's name inside the archive and the install folder. */
function binaryName(platform) {
  return platform === "win32" ? "ajour.exe" : "ajour";
}

/** An install that stopped on purpose: its event ends `refused`. */
class CliInstallRefusal extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}
const refusal = (reason, message) => new CliInstallRefusal(reason, message);

/** Whether an archive entry would land outside the folder it unpacks into. */
function escapesFolder(name) {
  const entry = name.replaceAll("\\", "/");
  return (
    entry.startsWith("/") ||
    /^[a-zA-Z]:/.test(entry) ||
    entry.split("/").some((segment) => segment === "..")
  );
}

/**
 * @param {{
 *   fetch: (url: string, init?: any) => Promise<any>,
 *   fs: typeof import("node:fs/promises"),
 *   exec: (file: string, args: string[], options?: { timeout?: number, env?: Record<string, string | undefined> }) => Promise<{ stdout: string }>,
 *   platform: string,
 *   arch: string,
 *   appVersion: string,
 *   development: boolean,
 *   releaseOrigin?: string,
 *   paths: { installDir: string, recordFile: string, tar: string },
 *   link: { add(folder: string): Promise<{ added: boolean }> },
 *   now?: () => number,
 *   env?: Record<string, string | undefined>,
 * }} options
 */
function createCliCommandController({
  fetch,
  fs,
  exec,
  platform,
  arch,
  appVersion,
  development,
  releaseOrigin,
  paths,
  link,
  now = Date.now,
  env = process.env,
}) {
  // A local fake release, for tests and the real-app check: development
  // builds only, so a packaged build always installs from GitHub.
  const localOrigin =
    development && typeof releaseOrigin === "string" && releaseOrigin
      ? releaseOrigin.replace(/\/+$/, "")
      : null;
  const apiOrigin = localOrigin ?? GITHUB_API_ORIGIN;
  const downloadOrigin = localOrigin ?? GITHUB_ORIGIN;
  const tag = tagForPackageVersion(appVersion);
  const asset = cliAssetName(platform, arch, appVersion);
  const binary = binaryName(platform);
  // A version with no release tag was never released: it builds from source.
  const unsupportedReason =
    platform !== "win32"
      ? "unsupported_platform"
      : (development && !localOrigin) || !tag
        ? "development_build"
        : null;

  const listeners = new Set();
  /** The state while an install runs, or after one failed; null otherwise. */
  let transient = null;
  /** Set after an install in this launch, for "Open a new terminal". */
  let newlyInstalled = false;
  let running = null;

  function emit(state) {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // One listener's failure never stops the others.
      }
    }
  }

  async function readRecord() {
    try {
      const record = JSON.parse(await fs.readFile(paths.recordFile, "utf8"));
      if (
        typeof record?.version !== "string" ||
        typeof record.binaryPath !== "string"
      ) {
        return null;
      }
      // The record is trusted only while its binary is there.
      const found = await fs.stat(record.binaryPath).catch(() => null);
      return found?.isFile() ? record : null;
    } catch {
      return null;
    }
  }

  /** The installed command, as the row shows it. */
  function installedFields(record) {
    return record
      ? {
          version: record.version,
          binaryPath: record.binaryPath,
          location: path.dirname(record.binaryPath),
        }
      : {};
  }

  async function settledState() {
    if (unsupportedReason) {
      return {
        status: "unsupported",
        reason: unsupportedReason,
        progress: null,
        error: null,
      };
    }
    const record = await readRecord();
    if (transient) return { ...installedFields(record), ...transient };
    return record
      ? {
          status: "installed",
          ...installedFields(record),
          progress: null,
          error: null,
          ...(newlyInstalled ? { newlyInstalled: true } : {}),
        }
      : { status: "not-installed", progress: null, error: null };
  }

  function publishInstalling(phase, progress = null) {
    transient = { status: "installing", phase, progress, error: null };
    emit({ ...transient });
  }

  /**
   * Fetches `url`, following each redirect itself: the `fetch` seam answers
   * a redirect instead of following it (Electron's `net.fetch` neither
   * reports nor returns one), so each hop is checked. A hop may change the
   * host, never leave HTTPS, except to the development build's local origin.
   */
  async function request(url, init, offline) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response;
      try {
        response = await fetch(current, { ...init, redirect: "manual" });
      } catch {
        throw new Error(offline);
      }
      const location = response.headers?.get?.("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        return response;
      }
      await response.body?.cancel?.().catch(() => undefined);
      current = new URL(location, current).href;
      if (
        !current.startsWith("https://") &&
        !(localOrigin && current.startsWith(`${localOrigin}/`))
      ) {
        throw refusal(
          "redirect_off_https",
          "The ajour download was redirected away from HTTPS, so Ajour stopped it.",
        );
      }
    }
    throw new Error("GitHub redirected Ajour too many times. Try again later.");
  }

  async function fetchJson(url) {
    const response = await request(
      url,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
      "Ajour couldn't reach GitHub. Check your connection, then try again.",
    );
    if (response.status === 404) {
      throw refusal(
        "missing_release",
        `Ajour couldn't find its release, ${tag}, on GitHub.`,
      );
    }
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}. Try again later.`);
    }
    return await response.json();
  }

  /** The asset's download URL, digest and size, checked. */
  async function resolveAsset(report) {
    const release = await fetchJson(
      `${apiOrigin}/repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
    );
    const found = Array.isArray(release?.assets)
      ? release.assets.find((candidate) => candidate?.name === asset)
      : undefined;
    if (!found) {
      throw refusal(
        "missing_asset",
        `The ${tag} release has no ajour for ${PLATFORM_NAMES[platform].label} ${arch} yet. Try again in a few minutes.`,
      );
    }
    const digest = DIGEST_PATTERN.exec(String(found.digest ?? ""));
    if (!digest) {
      throw refusal(
        "missing_digest",
        "GitHub published no checksum for the ajour download, so Ajour didn't install it.",
      );
    }
    const size = found.size;
    if (!Number.isInteger(size) || size <= 0) {
      throw refusal(
        "invalid_archive",
        "GitHub published no size for the ajour download, so Ajour didn't install it.",
      );
    }
    report.download_bytes = size;
    if (size > MAX_DOWNLOAD_BYTES) {
      throw refusal(
        "too_large",
        "The ajour download is larger than 120 MB, so Ajour didn't download it.",
      );
    }
    const releasePage = `${downloadOrigin}/${GITHUB_REPOSITORY}/releases/download/${tag}/`;
    const url = String(found.browser_download_url ?? "");
    if (url !== `${releasePage}${encodeURIComponent(asset)}`) {
      throw refusal(
        "url_not_allowed",
        "The ajour download isn't on Ajour's release page, so Ajour didn't download it.",
      );
    }
    return { url, sha256: digest[1], size };
  }

  /** Streams the download to `file`, hashing it, within the size it was given. */
  async function download({ url, sha256, size }, file) {
    const response = await request(
      url,
      { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) },
      "Ajour couldn't download ajour. Check your connection, then try again.",
    );
    if (!response.ok) {
      throw new Error(
        `The ajour download failed (HTTP ${response.status}). Try again later.`,
      );
    }
    const hash = createHash("sha256");
    const handle = await fs.open(file, "w", 0o600);
    let total = 0;
    // The install starts at 0%.
    let shown = 0;
    const progress = () => {
      const percent = Math.min(100, Math.floor((total / size) * 100));
      if (percent !== shown) {
        shown = percent;
        publishInstalling("downloading", percent);
      }
    };
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > size) {
          await reader.cancel().catch(() => undefined);
          throw refusal(
            "too_large",
            "The ajour download is larger than GitHub said, so Ajour stopped it.",
          );
        }
        hash.update(value);
        await handle.write(value);
        progress();
      }
    } finally {
      reader.releaseLock?.();
      await handle.close();
    }
    if (total !== size) {
      throw new Error("The ajour download ended early. Try again.");
    }
    if (hash.digest("hex") !== sha256) {
      throw refusal(
        "digest_mismatch",
        "The ajour download doesn't match its published checksum, so Ajour didn't install it.",
      );
    }
  }

  /** Unpacks `archive` into `folder` with the system tar, refusing escapes. */
  async function unpack(archive, folder) {
    const escaped = () =>
      refusal(
        "escaping_entry",
        "The ajour archive has a file that would land outside its folder, so Ajour didn't install it.",
      );
    let listing;
    try {
      listing = await exec(paths.tar, ["-tf", archive], {
        timeout: TAR_TIMEOUT_MS,
      });
    } catch {
      throw refusal(
        "invalid_archive",
        "Ajour couldn't unpack the ajour archive.",
      );
    }
    const entries = String(listing.stdout)
      .split(/\r?\n/)
      .filter((entry) => entry !== "");
    if (entries.some(escapesFolder)) throw escaped();
    await fs.mkdir(folder);
    try {
      await exec(paths.tar, ["-xf", archive, "-C", folder], {
        timeout: TAR_TIMEOUT_MS,
      });
    } catch {
      throw refusal(
        "invalid_archive",
        "Ajour couldn't unpack the ajour archive.",
      );
    }
    // Nothing unpacked may be a link that points elsewhere.
    const unpacked = await fs.readdir(folder, {
      recursive: true,
      withFileTypes: true,
    });
    if (unpacked.some((entry) => entry.isSymbolicLink())) throw escaped();
    const found = await fs.stat(path.join(folder, binary)).catch(() => null);
    if (!found?.isFile()) {
      throw refusal(
        "invalid_archive",
        `The ajour archive has no ${binary}, so Ajour didn't install it.`,
      );
    }
  }

  /** Checks that the unpacked binary is the app's own version. */
  async function checkVersion(file) {
    const expected = `ajour ${appVersion}`;
    let output;
    try {
      const result = await exec(file, ["-V"], {
        timeout: VERSION_CHECK_TIMEOUT_MS,
        // No connection to Ajour: -V needs none.
        env: { ...env, AJOUR_URL: "", AJOUR_TOKEN: "" },
      });
      output = String(result.stdout).trim();
    } catch {
      throw refusal(
        "wrong_version",
        "The downloaded ajour didn't print its version within 10 seconds, so Ajour didn't install it.",
      );
    }
    if (output !== expected) {
      throw refusal(
        "wrong_version",
        `The downloaded ajour says "${output.slice(0, 80)}", not "${expected}", so Ajour didn't install it.`,
      );
    }
  }

  /**
   * Moves each unpacked entry over the installed one. What was there is
   * renamed aside first, which Windows allows for a running ajour.exe.
   * Returns the undo, and the cleanup of what was set aside.
   */
  async function swapIn(unpacked, id) {
    const moves = [];
    const undo = async () => {
      for (const move of moves.reverse()) {
        await fs
          .rm(move.target, { recursive: true, force: true })
          .catch(() => undefined);
        if (move.aside)
          await fs.rename(move.aside, move.target).catch(() => undefined);
      }
    };
    try {
      for (const name of await fs.readdir(unpacked)) {
        const target = path.join(paths.installDir, name);
        const exists = await fs.lstat(target).catch(() => null);
        const aside = exists ? `${target}.old-${id}` : null;
        if (aside) await fs.rename(target, aside);
        moves.push({ target, aside });
        await fs.rename(path.join(unpacked, name), target);
      }
    } catch (error) {
      await undo();
      throw error;
    }
    const cleanup = async () => {
      for (const move of moves) {
        // A running ajour.exe can't be deleted: the next install sweeps it.
        if (move.aside)
          await fs
            .rm(move.aside, { recursive: true, force: true })
            .catch(() => undefined);
      }
    };
    return { undo, cleanup };
  }

  /** Deletes what an earlier install set aside and couldn't delete then. */
  async function sweepSetAside() {
    const names = await fs.readdir(paths.installDir).catch(() => []);
    for (const name of names) {
      if (
        /\.old-[0-9a-f-]{36}$/.test(name) ||
        /^\.staging-[0-9a-f-]{36}$/.test(name)
      ) {
        await fs
          .rm(path.join(paths.installDir, name), {
            recursive: true,
            force: true,
          })
          .catch(() => undefined);
      }
    }
  }

  async function writeRecord(record) {
    await fs.mkdir(path.dirname(paths.recordFile), { recursive: true });
    const temporary = `${paths.recordFile}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporary, paths.recordFile);
  }

  async function runInstall(unit) {
    const report = { platform, arch, version: appVersion };
    const started = now();
    const id = randomUUID();
    // The topmost folder this install made, removed again if it fails.
    let madeFolder;
    let staging;
    let swap;
    try {
      publishInstalling("downloading", 0);
      await sweepSetAside();
      const resolved = await resolveAsset(report);
      madeFolder = await fs.mkdir(paths.installDir, { recursive: true });
      staging = path.join(paths.installDir, `.staging-${id}`);
      await fs.mkdir(staging);
      const archive = path.join(staging, asset);
      await download(resolved, archive);
      report.download_ms = now() - started;

      publishInstalling("checking");
      const unpacked = path.join(staging, "unpacked");
      await unpack(archive, unpacked);
      await checkVersion(path.join(unpacked, binary));

      publishInstalling("linking");
      swap = await swapIn(unpacked, id);
      try {
        report.path_added = (await link.add(paths.installDir)).added;
      } catch (error) {
        throw Object.assign(
          new Error(
            "Ajour couldn't add ajour to your PATH, so nothing changed.",
          ),
          { cause: error },
        );
      }
      await writeRecord({
        version: appVersion,
        binaryPath: path.join(paths.installDir, binary),
        link: "path",
        installedAt: new Date(now()).toISOString(),
      });
      await swap.cleanup();
      swap = undefined;
      await fs
        .rm(staging, { recursive: true, force: true })
        .catch(() => undefined);
      report.result = "installed";
      newlyInstalled = true;
      transient = null;
    } catch (error) {
      await swap?.undo();
      if (staging)
        await fs
          .rm(staging, { recursive: true, force: true })
          .catch(() => undefined);
      if (madeFolder)
        await fs
          .rm(madeFolder, { recursive: true, force: true })
          .catch(() => undefined);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Ajour couldn't install ajour.";
      report.result = error instanceof CliInstallRefusal ? "refused" : "failed";
      if (error instanceof CliInstallRefusal) {
        unit?.refuse(error.reason);
      } else {
        unit?.fail(error);
      }
      transient = { status: "error", progress: null, error: message };
    } finally {
      unit?.set({ cli_command: report });
    }
    const state = await settledState();
    emit(state);
    return state;
  }

  return {
    async state() {
      return await settledState();
    },

    /**
     * Installs the app's version; a second call joins the one running.
     * @param {{ unit?: any }} [options] The event of the call that asked.
     */
    install({ unit } = {}) {
      if (unsupportedReason) {
        unit?.refuse(unsupportedReason);
        return settledState();
      }
      if (running) {
        unit?.set({ cli_command: { result: "joined" } });
        return running;
      }
      running = runInstall(unit).finally(() => {
        running = null;
      });
      return running;
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = {
  MAX_DOWNLOAD_BYTES,
  cliAssetName,
  createCliCommandController,
};
