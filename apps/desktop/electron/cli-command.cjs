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
 * 5. writes a swap journal in the install folder, then moves the files into
 *    the install folder, renaming what was there aside;
 * 6. puts the folder on the PATH, noting in the journal what it replaces
 *    before it writes;
 * 7. writes `cli-command.json` atomically, mode 0600. That is the commit:
 *    only then are the set-aside files and the journal deleted.
 *
 * Any failure puts back what was installed before, on disk and on the PATH,
 * and removes what it made. An install cut short, because Ajour quit or
 * crashed, is finished the same way on the next launch: `recover()` reads
 * the journal and rolls the swap back, or, when the record shows it
 * committed, deletes what it set aside. Quitting stops a download and waits,
 * within a bound, for a swap under way. A refusal ends the install's event
 * `refused` with its reason; anything else ends it as an error.
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
/** How long quitting waits for an install to finish or roll back. */
const STOP_TIMEOUT_MS = 5_000;
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const JOURNAL_NAME = new RegExp(`^\\.swap-(${ID})\\.json$`);
const STAGING_NAME = new RegExp(`^\\.staging-${ID}$`);

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
 *   link: {
 *     add(folder: string, hooks?: { beforeWrite?(change: object): Promise<void> }): Promise<{ added: boolean, change: object | null }>,
 *     revert(change: object | null): Promise<void>,
 *   },
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
  /** The recovery of an install cut short, run once per launch. */
  let recovery = null;
  /** Aborts a download when Ajour quits; no install starts after. */
  const quitting = new AbortController();

  function emit(state) {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // One listener's failure never stops the others.
      }
    }
  }

  /** The record as written, or null. */
  async function readRecordFile() {
    try {
      const record = JSON.parse(await fs.readFile(paths.recordFile, "utf8"));
      return typeof record?.version === "string" &&
        typeof record.binaryPath === "string"
        ? record
        : null;
    } catch {
      return null;
    }
  }

  async function readRecord() {
    const record = await readRecordFile();
    if (!record) return null;
    // The record is trusted only while its binary is there.
    const found = await fs.stat(record.binaryPath).catch(() => null);
    return found?.isFile() ? record : null;
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
    await recovered();
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

  /**
   * Streams the download to `file`, within the size it was given, then
   * checks the SHA-256 of what the file holds: the bytes tar will read.
   */
  async function download({ url, sha256, size }, file) {
    const response = await request(
      url,
      {
        signal: AbortSignal.any([
          AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
          quitting.signal,
        ]),
      },
      "Ajour couldn't download ajour. Check your connection, then try again.",
    );
    if (!response.ok) {
      throw new Error(
        `The ajour download failed (HTTP ${response.status}). Try again later.`,
      );
    }
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
        stopIfQuitting();
        total += value.byteLength;
        if (total > size) {
          await reader.cancel().catch(() => undefined);
          throw refusal(
            "too_large",
            "The ajour download is larger than GitHub said, so Ajour stopped it.",
          );
        }
        await writeWhole(handle, value);
        progress();
      }
    } finally {
      reader.releaseLock?.();
      await handle.close();
    }
    if (total !== size) {
      throw new Error("The ajour download ended early. Try again.");
    }
    if ((await sha256Of(file)) !== sha256) {
      throw refusal(
        "digest_mismatch",
        "The ajour download doesn't match its published checksum, so Ajour didn't install it.",
      );
    }
  }

  /** Writes all of `bytes`: a write may take only part of them. */
  async function writeWhole(handle, bytes) {
    for (let offset = 0; offset < bytes.byteLength;) {
      const { bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
      );
      if (!(bytesWritten > 0)) {
        throw new Error("Ajour couldn't save the ajour download.");
      }
      offset += bytesWritten;
    }
  }

  /** The SHA-256 of what `file` holds, read back from disk. */
  async function sha256Of(file) {
    const hash = createHash("sha256");
    const handle = await fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
    return hash.digest("hex");
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

  function stopIfQuitting() {
    if (quitting.signal.aborted) {
      throw new Error("Ajour quit before ajour was installed.");
    }
  }

  const journalFile = (id) => path.join(paths.installDir, `.swap-${id}.json`);
  const asideOf = (name, id) =>
    path.join(paths.installDir, `${name}.old-${id}`);

  /** Writes `file` whole or not at all: a temp file, then a rename. */
  async function writeAtomically(file, text) {
    const temporary = `${file}.tmp`;
    try {
      await fs.writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function writeJournal(journal) {
    await writeAtomically(journalFile(journal.id), JSON.stringify(journal));
  }

  async function writeRecord(record) {
    await fs.mkdir(path.dirname(paths.recordFile), { recursive: true });
    await writeAtomically(
      paths.recordFile,
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }

  /**
   * Moves each unpacked entry over the installed one, renaming what was
   * there aside first, which Windows allows for a running ajour.exe. The
   * journal lists every entry, and whether it had one to set aside, before
   * the first rename.
   */
  async function swapIn(journal, unpacked) {
    for (const entry of journal.entries) {
      const target = path.join(paths.installDir, entry.name);
      if (entry.aside) await fs.rename(target, asideOf(entry.name, journal.id));
      await fs.rename(path.join(unpacked, entry.name), target);
    }
  }

  /**
   * Undoes the swap of `journal`, from whatever step it reached: each entry
   * set aside goes back, each new one goes, the PATH is put back, and what
   * the install made is removed. Then the journal goes.
   */
  async function rollBack(journal) {
    for (const entry of [...journal.entries].reverse()) {
      const target = path.join(paths.installDir, entry.name);
      const aside = asideOf(entry.name, journal.id);
      const setAside = Boolean(await fs.lstat(aside).catch(() => null));
      // An entry not yet set aside is still the installed one.
      if (entry.aside && !setAside) continue;
      await fs.rm(target, { recursive: true, force: true });
      if (setAside) await fs.rename(aside, target);
    }
    await link.revert(journal.path ?? null);
    await fs.rm(`${paths.recordFile}.tmp`, { force: true });
    await removeQuietly(path.join(paths.installDir, `.staging-${journal.id}`));
    if (journal.madeFolder) await removeQuietly(journal.madeFolder);
    await fs.rm(journalFile(journal.id), { force: true });
  }

  /**
   * Deletes what a committed swap set aside, then its journal. A running
   * ajour.exe can't be deleted: the journal stays until it can, so the
   * next launch tries again.
   */
  async function finishCommitted(journal) {
    let left = 0;
    for (const entry of journal.entries) {
      if (!entry.aside) continue;
      await fs
        .rm(asideOf(entry.name, journal.id), { recursive: true, force: true })
        .catch(() => {
          left += 1;
        });
    }
    await removeQuietly(path.join(paths.installDir, `.staging-${journal.id}`));
    if (left === 0) {
      await fs.rm(journalFile(journal.id), { force: true }).catch(() => {});
    }
  }

  async function removeQuietly(target) {
    await fs
      .rm(target, { recursive: true, force: true })
      .catch(() => undefined);
  }

  /**
   * Finishes each install a quit or a crash cut short: one whose record was
   * written is kept, and any other is rolled back. Only then are staging
   * folders deleted; nothing set aside is deleted before its install
   * committed.
   */
  async function recoverSwaps() {
    const names = await fs.readdir(paths.installDir).catch(() => []);
    for (const name of names) {
      const id = JOURNAL_NAME.exec(name)?.[1];
      if (!id) {
        // A journal's first write that never reached its rename.
        if (/^\.swap-.*\.json\.tmp$/.test(name)) {
          await removeQuietly(path.join(paths.installDir, name));
        }
        continue;
      }
      let journal;
      try {
        journal = JSON.parse(
          await fs.readFile(path.join(paths.installDir, name), "utf8"),
        );
      } catch {
        // Unreadable: leave everything as it is rather than guess.
        continue;
      }
      if (journal?.id !== id || !Array.isArray(journal.entries)) continue;
      const record = await readRecordFile();
      const committed =
        record?.version === journal.version &&
        record.installedAt === journal.installedAt;
      await (committed ? finishCommitted(journal) : rollBack(journal));
    }
    for (const name of await fs.readdir(paths.installDir).catch(() => [])) {
      if (STAGING_NAME.test(name)) {
        await removeQuietly(path.join(paths.installDir, name));
      }
    }
  }

  function recovered() {
    recovery ??= recoverSwaps().catch(() => undefined);
    return recovery;
  }

  async function runInstall(unit) {
    const report = { platform, arch, version: appVersion };
    const started = now();
    const id = randomUUID();
    // The topmost folder this install made, removed again if it fails.
    let madeFolder;
    let staging;
    /** Set once the swap may have begun: a failure then rolls it back. */
    let journal;
    try {
      publishInstalling("downloading", 0);
      await recovered();
      stopIfQuitting();
      const resolved = await resolveAsset(report);
      stopIfQuitting();
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
      // From here the swap runs to its end, or rolls back: quitting waits.
      stopIfQuitting();

      publishInstalling("linking");
      const entries = [];
      for (const name of await fs.readdir(unpacked)) {
        const there = await fs
          .lstat(path.join(paths.installDir, name))
          .catch(() => null);
        entries.push({ name, aside: Boolean(there) });
      }
      const pending = {
        id,
        version: appVersion,
        installedAt: new Date(now()).toISOString(),
        madeFolder: madeFolder ?? null,
        entries,
        path: null,
      };
      await writeJournal(pending);
      journal = pending;
      await swapIn(journal, unpacked);
      try {
        const { added } = await link.add(paths.installDir, {
          // Noted before the write, so a crash after it can still undo it.
          beforeWrite: async (change) => {
            journal.path = change;
            await writeJournal(journal);
          },
        });
        report.path_added = added;
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
        installedAt: journal.installedAt,
      });
      const committed = journal;
      journal = undefined;
      await finishCommitted(committed);
      report.result = "installed";
      newlyInstalled = true;
      transient = null;
    } catch (error) {
      if (journal) {
        // What can't be put back now, the next launch puts back.
        await rollBack(journal).catch(() => undefined);
      } else {
        if (staging) await removeQuietly(staging);
        if (madeFolder) await removeQuietly(madeFolder);
      }
      const message = quitting.signal.aborted
        ? "Ajour quit before ajour was installed."
        : error instanceof Error && error.message
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
      if (quitting.signal.aborted) return settledState();
      if (running) {
        unit?.set({ cli_command: { result: "joined" } });
        return running;
      }
      running = runInstall(unit).finally(() => {
        running = null;
      });
      return running;
    },

    /**
     * Finishes an install that a quit or a crash cut short. Ajour calls it
     * at launch; `state()` and `install()` wait for it.
     */
    async recover() {
      if (unsupportedReason) return;
      await recovered();
    },

    /**
     * For quitting: stops a download, starts no new install, and waits for
     * one under way to finish or roll back, at most `timeoutMs`. A swap cut
     * at that bound is recovered on the next launch.
     */
    async stop(timeoutMs = STOP_TIMEOUT_MS) {
      quitting.abort();
      const settling = running ?? recovery;
      if (!settling) return;
      let timer;
      await Promise.race([
        settling.catch(() => undefined),
        new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
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
