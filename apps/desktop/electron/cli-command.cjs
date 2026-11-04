const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const { tagForPackageVersion } = require("./update-check.cjs");

/** The record commits an install. Reconciliation restores its content and PATH. */

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

const PENDING_NAME = new RegExp(`^\\.pending-${ID}\\.json$`);

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
 *   allowAdHocSignature?: boolean,
 *   paths: { installDir: string, recordFile: string, tar: string },
 *   link: {
 *     add(folder: string, options?: { interactive: boolean }): Promise<{ added: boolean }>,
 *     remove(folder: string, options?: { interactive: boolean }): Promise<{ added: boolean, cleanupSafe?: boolean }>,
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
  allowAdHocSignature = false,
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
  const unsupportedReason = !["win32", "darwin"].includes(platform)
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
  let reconciliation = null;
  let initialized = false;
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
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
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
          location:
            platform === "darwin"
              ? "/usr/local/bin/ajour"
              : path.dirname(record.binaryPath),
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
    if (!initialized && !running) await reconcileState();
    let record;
    try {
      record = await readRecord();
    } catch (error) {
      return { status: "error", progress: null, error: error.message };
    }
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

  const asideOf = (name, id) =>
    path.join(paths.installDir, `${name}.old-${id}`);
  const targetOf = (name) => path.join(paths.installDir, name);
  async function exists(file) {
    try {
      await fs.lstat(file);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  async function namesIn(folder) {
    try {
      return await fs.readdir(folder);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  // Hash relative names and bytes, so manuals and completions form one committed tree.
  async function contentDigest(file) {
    if (!(await exists(file))) return null;
    const stat = await fs.lstat(file);
    if (stat.isFile()) return sha256Of(file);
    const hash = createHash("sha256");
    for (const name of (await namesIn(file)).sort()) {
      hash.update(
        JSON.stringify([name, await contentDigest(path.join(file, name))]),
      );
    }
    return hash.digest("hex");
  }

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

  async function writeRecord(record) {
    await fs.mkdir(path.dirname(paths.recordFile), { recursive: true });
    await writeAtomically(
      paths.recordFile,
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }

  async function removeQuietly(target) {
    await fs
      .rm(target, { recursive: true, force: true })
      .catch(() => undefined);
  }

  const isOldName = (candidate, name) =>
    new RegExp(`^${name.replaceAll(".", "\\.")}\\.old-${ID}$`).test(candidate);

  async function reconcileDisk(interactive = false) {
    const names = await namesIn(paths.installDir);
    let record = await readRecordFile();
    const entries = [binary, "share"];
    for (const name of entries) {
      const target = targetOf(name);
      const old = [];
      for (const candidate of names.filter((item) => isOldName(item, name))) {
        const file = targetOf(candidate);
        old.push({ file, time: (await fs.stat(file)).mtimeMs });
      }
      old.sort((a, b) => b.time - a.time || b.file.localeCompare(a.file));
      const expected = record?.digests?.[name];
      if (record && Object.hasOwn(record.digests ?? {}, name)) {
        if ((await contentDigest(target)) !== expected) {
          if (expected === null) {
            await fs.rm(target, { recursive: true, force: true });
            continue;
          }
          let match;
          for (const candidate of old) {
            if ((await contentDigest(candidate.file)) === expected) {
              match = candidate.file;
              break;
            }
          }
          if (match) {
            await fs.rm(target, { recursive: true, force: true });
            await fs.rename(match, target);
          } else if (name === binary && !(await exists(target))) {
            await fs.rm(paths.recordFile, { force: true });
            record = null;
          } else {
            throw new Error(
              `Ajour couldn't restore the committed ${name}. Retry when its files are available.`,
            );
          }
        }
      } else if (record) {
        // Compatibility with records from before content digests were recorded.
        if (!(await exists(target)) && old.length)
          await fs.rename(old[0].file, target);
      }
    }
    if (record && !(await exists(targetOf(binary)))) {
      await fs.rm(paths.recordFile, { force: true });
      record = null;
    }
    if (!record) {
      // A missing record proves nothing about files in the user's folder.
      // Only a fully written pending marker identifies an uncommitted swap.
      for (const marker of names.filter((name) => PENDING_NAME.test(name))) {
        let pending;
        try {
          pending = JSON.parse(await fs.readFile(targetOf(marker), "utf8"));
        } catch (error) {
          if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
          throw error;
        }
        for (const name of entries) {
          const expected = pending?.digests?.[name];
          if (
            typeof expected === "string" &&
            /^[0-9a-f]{64}$/.test(expected) &&
            (await contentDigest(targetOf(name))) === expected
          )
            await fs.rm(targetOf(name), { recursive: true, force: true });
        }
      }
    }
    let result = { added: false };
    if (record) result = await link.add(paths.installDir, { interactive });
    else {
      const removal = await link.remove(paths.installDir, { interactive });
      if (removal?.cleanupSafe === false)
        throw new Error(
          "Another ajour is at /usr/local/bin/ajour. Remove it, then press Retry in Settings.",
        );
    }
    // Link operations must confirm the committed target or absence before cleanup.
    for (const name of await namesIn(paths.installDir)) {
      const old = entries.some((entry) => isOldName(name, entry));
      if (
        STAGING_NAME.test(name) ||
        old ||
        PENDING_NAME.test(name) ||
        (name.endsWith(".tmp") && PENDING_NAME.test(name.slice(0, -4)))
      ) {
        try {
          await fs.rm(targetOf(name), { recursive: true, force: true });
        } catch (error) {
          if (!old || !["EPERM", "EACCES", "EBUSY"].includes(error.code))
            throw error;
        }
      }
    }
    await fs.rm(`${paths.recordFile}.tmp`, { force: true });
    return result;
  }

  async function reconcileState() {
    if (unsupportedReason) return;
    reconciliation ??= reconcileDisk();
    try {
      await reconciliation;
      transient = null;
    } catch (error) {
      transient = {
        status: "error",
        progress: null,
        error: error.message || "Ajour couldn't reconcile the command.",
      };
    } finally {
      initialized = true;
      reconciliation = null;
    }
  }

  async function refuseForeignFiles() {
    if (await readRecordFile()) return;
    if ((await exists(targetOf(binary))) || (await exists(targetOf("share")))) {
      throw refusal(
        "foreign_command",
        `There's already an ajour in ${paths.installDir} that Ajour didn't install. Remove it, then install again.`,
      );
    }
  }

  async function runInstall(unit) {
    const report = { platform, arch, version: appVersion };
    const started = now();
    const id = randomUUID();
    let staging;
    let swapped = false;
    let committed = false;
    let linkAdded = false;
    try {
      if (reconciliation) await reconciliation;
      await reconcileDisk(platform === "darwin");
      initialized = true;
      // Retry repairs an existing commit without another download or swap.
      if (
        transient?.status === "error" &&
        (await readRecord())?.version === appVersion
      ) {
        transient = null;
        report.result = "installed";
        newlyInstalled = true;
        const state = await settledState();
        emit(state);
        return state;
      }
      await refuseForeignFiles();
      publishInstalling("downloading", 0);
      stopIfQuitting();
      const resolved = await resolveAsset(report);
      stopIfQuitting();
      await fs.mkdir(paths.installDir, { recursive: true });
      staging = path.join(paths.installDir, `.staging-${id}`);
      await fs.mkdir(staging);
      const archive = path.join(staging, asset);
      await download(resolved, archive);
      report.download_ms = now() - started;

      publishInstalling("checking");
      const unpacked = path.join(staging, "unpacked");
      await unpack(archive, unpacked);
      if (platform === "darwin") {
        try {
          await exec(
            "/usr/bin/codesign",
            [
              "--verify",
              "--strict",
              ...(development && localOrigin && allowAdHocSignature
                ? []
                : [
                    "-R",
                    'anchor apple generic and certificate leaf[subject.OU] = "DDX8GJH69G"',
                  ]),
              path.join(unpacked, binary),
            ],
            { timeout: VERSION_CHECK_TIMEOUT_MS },
          );
        } catch {
          throw refusal(
            "invalid_signature",
            "The download isn't signed by Ajour. Nothing was installed.",
          );
        }
      }
      await checkVersion(path.join(unpacked, binary));
      // From here the swap runs to its end, or rolls back: quitting waits.
      stopIfQuitting();

      publishInstalling("linking");
      // Releases store man/ and completions/ at the archive root.
      const share = path.join(unpacked, "share");
      await fs.mkdir(share, { recursive: true });
      for (const name of ["man", "completions"]) {
        if (await exists(path.join(unpacked, name)))
          await fs.rename(path.join(unpacked, name), path.join(share, name));
      }
      const digests = {};
      for (const name of [binary, "share"])
        digests[name] = await contentDigest(path.join(unpacked, name));
      // Upgrade a pre-digest record before any swap, while its files are whole.
      const previous = await readRecord();
      if (previous && !previous.digests) {
        previous.digests = {};
        for (const name of [binary, "share"])
          previous.digests[name] = await contentDigest(targetOf(name));
        await writeRecord(previous);
      }
      await refuseForeignFiles();
      await writeAtomically(
        targetOf(`.pending-${id}.json`),
        JSON.stringify({ digests }),
      );
      swapped = true;
      for (const name of [binary, "share"]) {
        if (await exists(targetOf(name)))
          await fs.rename(targetOf(name), asideOf(name, id));
        await fs.rename(path.join(unpacked, name), targetOf(name));
      }
      if (platform === "darwin")
        linkAdded = (await link.add(paths.installDir, { interactive: true }))
          .added;
      await writeRecord({
        version: appVersion,
        binaryPath: targetOf(binary),
        installedAt: new Date(now()).toISOString(),
        digests,
      });
      committed = true;
      const { added } = await reconcileDisk();
      report.path_added = added || linkAdded;
      report.result = "installed";
      newlyInstalled = true;
      transient = null;
    } catch (error) {
      initialized = true;
      if (swapped && !committed) await reconcileDisk().catch(() => undefined);
      if (staging) await removeQuietly(staging);
      const message = quitting.signal.aborted
        ? "Ajour quit before ajour was installed."
        : error instanceof Error && error.message
          ? error.message
          : "Ajour couldn't install ajour.";
      report.result = error.reason ? "refused" : "failed";
      if (error.reason) {
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

    async reconcile() {
      if (running) return running;
      await reconcileState();
      const state = await settledState();
      emit(state);
      return state;
    },

    /**
     * For quitting: stops a download, starts no new install, and waits for
     * one under way to finish or roll back, at most `timeoutMs`. A swap cut
     * at that bound is reconciled on the next launch.
     */
    async stop(timeoutMs = STOP_TIMEOUT_MS) {
      quitting.abort();
      const settling = running ?? reconciliation;
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
