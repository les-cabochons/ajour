const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const {
  CliInstallRefusal,
  createReleaseAssetPipeline,
  MAX_DOWNLOAD_BYTES,
  refusal,
} = require("./cli-release-asset.cjs");
const { tagForPackageVersion } = require("./update-check.cjs");
const { codesignVerifyArgs } = require("./cli-signature.cjs");

/** The record commits an install. Reconciliation restores its content and PATH. */

const VERSION_CHECK_TIMEOUT_MS = 10_000;
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

/** How long a command in a WSL distro may take: the first boots WSL's VM. */
const WSL_TIMEOUT_MS = 60_000;
/** How long the list of WSL distros stays fresh. */
const DISTRO_LIST_MS = 30_000;
/** Docker Desktop's own distros, which no one types in. */
const DOCKER_DISTRO = /^docker-desktop(?:-data)?$/i;
/** The link step's exit status when `~/.local/bin/ajour` isn't Ajour's. */
const FOREIGN_LINK = 17;

// Scripts run in a distro as `sh -c SCRIPT sh VALUE…`: each value is an
// argument ("$1"…), never pasted into the script. Each line is a whole
// statement, so the lines join into one command-line argument.

/**
 * Links `~/.local/bin/ajour` to "$1". A link to "$1" already is left as it
 * is; anything else at that name exits 17. A new link prints
 * `created:<bin>:<local>`, 1 for each folder it made, so the link can be
 * undone.
 */
const LINK_SCRIPT = [
  'link="$HOME/.local/bin/ajour"',
  'if [ -L "$link" ] && [ "$(readlink "$link")" = "$1" ]; then exit 0; fi',
  `if [ -e "$link" ] || [ -L "$link" ]; then exit ${FOREIGN_LINK}; fi`,
  'if [ -d "$HOME/.local" ]; then madelocal=0; else madelocal=1; fi',
  'if [ -d "$HOME/.local/bin" ]; then madebin=0; else madebin=1; fi',
  'if mkdir -p "$HOME/.local/bin" && ln -s "$1" "$link"; then printf "created:%s:%s" "$madebin" "$madelocal"; exit 0; fi',
  'if [ "$madebin" = 1 ]; then rmdir "$HOME/.local/bin" 2>/dev/null; fi',
  'if [ "$madelocal" = 1 ]; then rmdir "$HOME/.local" 2>/dev/null; fi',
  "exit 1",
].join("; ");

/** Undoes LINK_SCRIPT: removes the link to "$1", then the folders it made ("$2", "$3"). */
const UNLINK_SCRIPT = [
  'link="$HOME/.local/bin/ajour"',
  'if [ -L "$link" ] && [ "$(readlink "$link")" = "$1" ]; then rm -f -- "$link"; fi',
  'if [ "$2" = 1 ]; then rmdir "$HOME/.local/bin" 2>/dev/null; fi',
  'if [ "$3" = 1 ]; then rmdir "$HOME/.local" 2>/dev/null; fi',
  "exit 0",
].join("; ");

/** The login shell's HOME and PATH, last, after anything its profile prints. */
const LOGIN_PATH_SCRIPT = 'printf "\\n%s\\n%s\\n" "$HOME" "$PATH"';

/** The distros `wsl.exe --list --quiet` printed, in UTF-8 or UTF-16LE. */
function distroNamesOf(stdout) {
  const bytes = Buffer.isBuffer(stdout)
    ? stdout
    : Buffer.from(String(stdout), "utf8");
  // WSL answers in UTF-16LE unless it honours WSL_UTF8.
  const text = bytes.includes(0)
    ? bytes.toString("utf16le")
    : bytes.toString("utf8");
  return [
    ...new Set(
      text
        .replace(/^﻿/, "")
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter((name) => name && !DOCKER_DISTRO.test(name)),
    ),
  ];
}

/**
 * @param {{
 *   fetch: (url: string, init?: any) => Promise<any>,
 *   fs: typeof import("node:fs/promises"),
 *   exec: (file: string, args: string[], options?: { timeout?: number, env?: Record<string, string | undefined>, encoding?: "buffer" }) => Promise<{ stdout: string | Buffer }>,
 *   platform: string,
 *   arch: string,
 *   appVersion: string,
 *   development: boolean,
 *   releaseOrigin?: string,
 *   allowAdHocSignature?: boolean,
 *   events?: { start(name: string, options: any): any },
 *   followRetryMs?: number,
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
  events,
  followRetryMs,
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
  let following = false;
  let retryTimer;
  let missingAttempts = 0;
  const retryDelay = (first) =>
    development &&
    localOrigin &&
    Number.isFinite(followRetryMs) &&
    followRetryMs > 0
      ? followRetryMs
      : first
        ? 5 * 60_000
        : 60 * 60_000;
  let reconciliation = null;
  let initialized = false;
  /** Aborts a download when Ajour quits; no install starts after. */
  const quitting = new AbortController();

  // WSL distros (#604): x64 Windows only, as no linux-arm64 build ships.
  const wslSupported =
    !unsupportedReason && platform === "win32" && arch === "x64";
  /** The distros WSL listed last, and when. Never read at launch. */
  let distroNames = [];
  let distroReadAt = -Infinity;
  let distroRead = null;
  /**
   * Per distro, an Add running (`adding`), its failure (`error`), or the hint
   * of an Add that succeeded in this launch. "Added" itself is the record's.
   */
  const wslStates = new Map();
  const wslExe = path.win32.join(
    env.SystemRoot || "C:\\Windows",
    "System32",
    "wsl.exe",
  );

  /** Reads WSL's distros, at most once per 30 seconds unless `fresh`. */
  async function listDistros({ fresh = false } = {}) {
    if (!fresh && now() - distroReadAt < DISTRO_LIST_MS) return;
    distroRead ??= (async () => {
      try {
        const { stdout } = await exec(wslExe, ["--list", "--quiet"], {
          timeout: VERSION_CHECK_TIMEOUT_MS,
          env: { ...env, WSL_UTF8: "1" },
          encoding: "buffer",
        });
        distroNames = distroNamesOf(stdout);
      } catch {
        // No WSL, or none it can list: no rows.
        distroNames = [];
      }
      distroReadAt = now();
    })().finally(() => {
      distroRead = null;
    });
    await distroRead;
  }

  /** The `wsl` part of the state: one row per listed distro. */
  function wslFields(record) {
    if (!wslSupported || !record || !distroNames.length) return {};
    return {
      wsl: {
        version: record.wsl?.version,
        distros: distroNames.map((name) => {
          const added = record.wsl?.distros?.includes(name) ?? false;
          const live = wslStates.get(name);
          if (live?.status) return { name, ...live };
          return {
            name,
            status: added ? "added" : "not-added",
            progress: null,
            error: null,
            ...(added && live?.hint ? { hint: live.hint } : {}),
          };
        }),
      },
    };
  }

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
    const wsl = wslFields(record);
    if (transient) return { ...installedFields(record), ...transient, ...wsl };
    return record
      ? {
          status: "installed",
          ...wsl,
          ...installedFields(record),
          progress: null,
          error: null,
          ...(newlyInstalled ? { newlyInstalled: true } : {}),
        }
      : { status: "not-installed", progress: null, error: null };
  }

  function publishInstalling(phase, progress = null) {
    transient = {
      status: "installing",
      phase,
      progress,
      error: null,
      ...(following ? { pending: appVersion } : {}),
    };
    emit({ ...transient });
  }

  const { resolveAsset, download, unpack, sha256Of } =
    createReleaseAssetPipeline({
      fetch,
      fs,
      exec,
      paths,
      asset,
      binary,
      appVersion,
      label: PLATFORM_NAMES[platform]?.label,
      arch,
      development,
      releaseOrigin,
      signal: quitting.signal,
      onProgress: (percent) => publishInstalling("downloading", percent),
    });

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
    const entries = [binary, "share", "linux"];
    const ownedDigests = { ...record?.digests, ...record?.wsl?.digests };
    for (const name of entries) {
      const target = targetOf(name);
      const old = [];
      for (const candidate of names.filter((item) => isOldName(item, name))) {
        const file = targetOf(candidate);
        old.push({ file, time: (await fs.stat(file)).mtimeMs });
      }
      old.sort((a, b) => b.time - a.time || b.file.localeCompare(a.file));
      const expected = ownedDigests[name];
      if (record && Object.hasOwn(ownedDigests, name)) {
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
      } else if (record && name !== "linux") {
        // Compatibility with records from before content digests were recorded.
        if (!(await exists(target)) && old.length)
          await fs.rename(old[0].file, target);
      }
    }
    if (record && !(await exists(targetOf(binary)))) {
      await fs.rm(paths.recordFile, { force: true });
      record = null;
    }
    // Removing a privileged link can require Retry. Keep its pending target
    // intact until removal succeeds, so launch recovery cannot leave it dangling.
    let result = { added: false };
    if (record) result = await link.add(paths.installDir, { interactive });
    else {
      const removal = await link.remove(paths.installDir, { interactive });
      if (removal?.cleanupSafe === false)
        throw new Error(
          "Another ajour is at /usr/local/bin/ajour. Remove it, then press Retry in Settings.",
        );
    }
    {
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
          if (record && Object.hasOwn(ownedDigests, name)) continue;
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
    if (!record) {
      try {
        await fs.rmdir(paths.installDir);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code))
          throw error;
      }
    }
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
    if (
      (await exists(targetOf(binary))) ||
      (await exists(targetOf("share"))) ||
      (await exists(targetOf("linux")))
    ) {
      throw refusal(
        "foreign_command",
        `There's already an ajour in ${paths.installDir} that Ajour didn't install. Remove it, then install again.`,
      );
    }
  }

  async function runInstall(unit, follow = false, interactive = !follow) {
    const report = { platform, arch, version: appVersion };
    const started = now();
    const id = randomUUID();
    let staging;
    let swapped = false;
    let committed = false;
    let linkAdded = false;
    try {
      if (reconciliation) await reconciliation;
      await reconcileDisk(platform === "darwin" && interactive);
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
          const file = path.join(unpacked, binary);
          await exec(
            "/usr/bin/codesign",
            development && localOrigin && allowAdHocSignature
              ? ["--verify", "--strict", file]
              : codesignVerifyArgs(file),
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
        linkAdded = (await link.add(paths.installDir, { interactive })).added;
      await writeRecord({
        version: appVersion,
        binaryPath: targetOf(binary),
        ...(previous?.wsl ? { wsl: previous.wsl } : {}),
        installedAt: new Date(now()).toISOString(),
        digests,
      });
      committed = true;
      const { added } = await reconcileDisk();
      report.path_added = added || linkAdded;
      report.result = "installed";
      newlyInstalled = !follow;
      missingAttempts = 0;
      transient = null;
      // Settings shows the WSL rows with the installed command. A follow
      // runs at launch, which never reads them.
      if (!follow && wslSupported) await listDistros();
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
        unit?.fail(error, follow ? { reason: "follow_failed" } : undefined);
      }
      transient = {
        status: "error",
        progress: null,
        error: message,
        ...(follow ? { pending: appVersion } : {}),
      };
      if (
        follow &&
        error.reason === "missing_asset" &&
        !quitting.signal.aborted
      ) {
        retryTimer = setTimeout(
          () => {
            retryTimer = undefined;
            void followAppVersion().catch(() => undefined);
          },
          retryDelay(missingAttempts++ === 0),
        );
        retryTimer.unref?.();
      }
    } finally {
      unit?.set({ cli_command: report });
    }
    const state = await settledState();
    emit(state);
    return state;
  }

  async function runRemove(unit) {
    let previous;
    let marker;
    try {
      if (reconciliation) await reconciliation;
      transient = { status: "removing", progress: null, error: null };
      emit({ ...transient });
      previous = await readRecordFile();
      if (previous) {
        // Retain ownership evidence before deleting the commit. Recovery uses
        // the same pending-file cleanup as an interrupted install.
        const digests = { ...previous.digests };
        if (!previous.digests) {
          for (const name of [binary, "share"])
            digests[name] = await contentDigest(targetOf(name));
        }
        // The Linux build for WSL goes with the command. Its links stay in
        // their distros.
        Object.assign(digests, previous.wsl?.digests);
        marker = targetOf(`.pending-${randomUUID()}.json`);
        await writeAtomically(marker, JSON.stringify({ digests }));
        await fs.rm(paths.recordFile, { force: true });
      }
      await reconcileDisk(true);
      newlyInstalled = false;
      transient = null;
      wslStates.clear();
      unit?.set({ cli_command: { result: "removed" } });
    } catch (error) {
      // Cancellation happens before any file cleanup. Restore the commit so
      // a later launch cannot silently finish a cancelled user action.
      if (error.reason === "admin_cancelled" && previous) {
        await writeRecord(previous);
        if (marker) await fs.rm(marker, { force: true });
      }
      if (error.reason) unit?.refuse(error.reason);
      else unit?.fail(error, { reason: "remove_failed" });
      unit?.set({
        cli_command: { result: error.reason ? "refused" : "failed" },
      });
      transient = {
        status: "error",
        operation: "remove",
        progress: null,
        error: error.message || "Ajour couldn't remove the ajour command.",
      };
    }
    initialized = true;
    const state = await settledState();
    emit(state);
    return state;
  }

  /**
   * Runs `program` in `distro` with `args`, each passed to `wsl.exe` as an
   * argument of its own, never pasted into a shell string.
   */
  async function inDistro(distro, program, args, timeout = WSL_TIMEOUT_MS) {
    try {
      const { stdout } = await exec(
        wslExe,
        ["-d", distro, "--exec", program, ...args],
        { timeout, env },
      );
      return String(stdout);
    } catch (error) {
      throw Object.assign(
        new Error(
          `Ajour couldn't run commands in ${distro}. Check that it starts, then try again.`,
        ),
        { exitCode: error?.code, timedOut: Boolean(error?.killed) },
      );
    }
  }

  /**
   * Downloads and unpacks the Linux build into `bin\linux`, swapped in as
   * the Windows files are: a pending marker first, the old build set aside.
   * Until the record commits it, reconciliation takes it back out.
   */
  async function downloadLinux(id, staging, publish) {
    const linuxAsset = `ajour-${appVersion}-linux-x64.tar.gz`;
    const pipeline = createReleaseAssetPipeline({
      fetch,
      fs,
      exec,
      paths,
      asset: linuxAsset,
      binary: "ajour",
      appVersion,
      label: "Linux",
      arch: "x64",
      development,
      releaseOrigin,
      signal: quitting.signal,
      onProgress: (percent) => void publish("downloading", percent),
    });
    const resolved = await pipeline.resolveAsset({});
    const archive = path.join(staging, linuxAsset);
    await pipeline.download(resolved, archive);
    await publish("checking");
    const unpacked = path.join(staging, "unpacked");
    await pipeline.unpack(archive, unpacked);
    // Releases store man/ and completions/ at the archive root.
    const share = path.join(unpacked, "share");
    await fs.mkdir(share, { recursive: true });
    for (const name of ["man", "completions"]) {
      if (await exists(path.join(unpacked, name)))
        await fs.rename(path.join(unpacked, name), path.join(share, name));
    }
    const digests = { linux: await contentDigest(unpacked) };
    stopIfQuitting();
    await writeAtomically(
      targetOf(`.pending-${id}.json`),
      JSON.stringify({ digests }),
    );
    if (await exists(targetOf("linux")))
      await fs.rename(targetOf("linux"), asideOf("linux", id));
    await fs.rename(unpacked, targetOf("linux"));
    return digests;
  }

  /**
   * Adds the command to `distro` (#604): the Linux build in `bin\linux`,
   * checked inside the distro, then `~/.local/bin/ajour` linked to it. The
   * record commits it last; any failure before leaves the record, `bin\linux`
   * and the distro as they were.
   */
  async function runAddWsl(distro, unit) {
    if (!wslSupported || quitting.signal.aborted) return settledState();
    // The renderer passes a name; only one WSL lists now is used.
    if (!distroNames.includes(distro)) await listDistros({ fresh: true });
    if (!distroNames.includes(distro)) {
      unit?.refuse("unknown_distro");
      unit?.set({ cli_command: { result: "refused" } });
      throw refusal(
        "unknown_distro",
        "Ajour can't find this distro in WSL's list any more. Reopen Settings to see the current list.",
      );
    }
    const id = randomUUID();
    let staging;
    let swapped = false;
    let committed = false;
    /** The link this Add made, and the folders it made for it. */
    let made = null;
    const publish = async (phase, progress = null) => {
      wslStates.set(distro, { status: "adding", phase, progress, error: null });
      emit(await settledState());
    };
    try {
      if (reconciliation) await reconciliation;
      await reconcileDisk();
      initialized = true;
      const record = await readRecord();
      if (!record)
        throw refusal(
          "not_installed",
          "Install the ajour command first, then add it to WSL.",
        );
      await publish("downloading", 0);
      let digests = record.wsl?.digests;
      // A second distro, or the same one again, reuses this version's build.
      if (record.wsl?.version !== appVersion) {
        if (!record.wsl && (await exists(targetOf("linux"))))
          throw refusal(
            "foreign_command",
            `There's already an ajour in ${targetOf("linux")} that Ajour didn't install. Remove it, then add again.`,
          );
        staging = targetOf(`.staging-${id}`);
        await fs.mkdir(staging);
        swapped = true;
        digests = await downloadLinux(id, staging, publish);
      }

      await publish("checking");
      const target = (
        await inDistro(distro, "wslpath", [
          "-u",
          path.join(targetOf("linux"), "ajour"),
        ])
      ).trim();
      if (!target.startsWith("/") || /[\n\0]/.test(target))
        throw new Error(
          `Ajour couldn't find its folder in ${distro}. Check that WSL can reach your Windows drive.`,
        );
      let printed;
      try {
        printed = (
          await inDistro(distro, target, ["-V"], VERSION_CHECK_TIMEOUT_MS)
        ).trim();
      } catch (error) {
        throw refusal(
          "wrong_version",
          error.timedOut
            ? "The downloaded ajour didn't print its version within 10 seconds, so Ajour didn't install it."
            : `The downloaded ajour didn't start in ${distro}, so Ajour didn't add it.`,
        );
      }
      if (printed !== `ajour ${appVersion}`)
        throw refusal(
          "wrong_version",
          `The downloaded ajour says "${printed.slice(0, 80)}", not "ajour ${appVersion}", so Ajour didn't install it.`,
        );

      await publish("linking");
      let linked;
      try {
        linked = await inDistro(distro, "sh", [
          "-c",
          LINK_SCRIPT,
          "sh",
          target,
        ]);
      } catch (error) {
        if (error.exitCode === FOREIGN_LINK)
          throw refusal(
            "foreign_command",
            `Another ajour is at ~/.local/bin/ajour in ${distro}. Remove it, then add again.`,
          );
        throw error;
      }
      const created = /^created:([01]):([01])$/.exec(linked.trim());
      if (created) made = { target, bin: created[1], local: created[2] };

      // Ubuntu and Debian's ~/.profile adds ~/.local/bin once it exists.
      const [home, loginPath] = (
        await inDistro(distro, "sh", ["-lc", LOGIN_PATH_SCRIPT])
      )
        .split("\n")
        .slice(-3, -1);
      const onPath = (loginPath ?? "")
        .split(":")
        .includes(`${home}/.local/bin`);

      const distros = record.wsl?.distros ?? [];
      if (record.wsl?.version !== appVersion || !distros.includes(distro))
        await writeRecord({
          ...record,
          wsl: {
            version: appVersion,
            digests,
            distros: [...new Set([...distros, distro])],
          },
        });
      committed = true;
      wslStates.set(distro, {
        hint: onPath
          ? `Open a new ${distro} terminal to use it.`
          : `Add ~/.local/bin to your PATH in ${distro}.`,
      });
      unit?.set({ cli_command: { result: "installed" } });
    } catch (error) {
      if (made && !committed) {
        await inDistro(distro, "sh", [
          "-c",
          UNLINK_SCRIPT,
          "sh",
          made.target,
          made.bin,
          made.local,
        ]).catch(() => undefined);
      }
      const message = quitting.signal.aborted
        ? "Ajour quit before ajour was added."
        : error instanceof Error && error.message
          ? error.message
          : "Ajour couldn't add ajour to WSL.";
      wslStates.set(distro, {
        status: "error",
        progress: null,
        error: message,
      });
      // Never the message: it names the distro, and a path holds the user name.
      if (error.reason) unit?.refuse(error.reason);
      else
        unit?.fail(new Error("Ajour couldn't add ajour to WSL."), {
          reason: "wsl_add_failed",
        });
      unit?.set({
        cli_command: { result: error.reason ? "refused" : "failed" },
      });
    } finally {
      // Commits clean up their marker; a failure takes the build back out.
      if (swapped) await reconcileDisk().catch(() => undefined);
      if (staging) await removeQuietly(staging);
    }
    const state = await settledState();
    emit(state);
    return state;
  }

  function trackRunning(work) {
    const task = work.finally(() => {
      if (running === task) running = null;
    });
    running = task;
    return task;
  }

  /** Follows only an existing install, through the same checks, without a prompt. */
  function followAppVersion(interactive = false) {
    if (unsupportedReason || quitting.signal.aborted) return settledState();
    if (running) return running;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    following = true;
    return trackRunning(
      (async () => {
        if (!initialized) await reconcileState();
        const record = await readRecord();
        if (!record || (record.version === appVersion && !transient?.pending))
          return settledState();
        const unit = events?.start("cli_command.follow", {
          kind: "job",
          trigger: "system",
          detached: true,
        });
        try {
          return await runInstall(unit, true, interactive);
        } finally {
          unit?.end();
        }
      })().finally(() => {
        following = false;
      }),
    );
  }

  return {
    followAppVersion,

    /**
     * Adds the command to the WSL distro `distro`, after the operation
     * running. Rejects only for a distro WSL doesn't list.
     * @param {string} distro
     * @param {{ unit?: any }} [options] The event of the call that asked.
     */
    addWsl(distro, { unit } = {}) {
      const before = running;
      return trackRunning(
        (async () => {
          if (before) await before.catch(() => undefined);
          return runAddWsl(distro, unit);
        })(),
      );
    },

    /** @param {{ unit?: any }} [options] */
    remove({ unit } = {}) {
      if (unsupportedReason || quitting.signal.aborted) return settledState();
      // Queue after the current install/follow, then claim running immediately.
      // Timers and Retry join this promise and cannot resurrect the command.
      const before = running;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      return trackRunning(
        (async () => {
          if (before) await before;
          clearTimeout(retryTimer);
          retryTimer = undefined;
          return runRemove(unit);
        })(),
      );
    },

    /** The state Settings shows. It reads WSL's distros, never at launch. */
    async state() {
      if (wslSupported && (await readRecord().catch(() => null)))
        await listDistros();
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
      if (transient?.pending) return followAppVersion(true);
      clearTimeout(retryTimer);
      retryTimer = undefined;
      if (running) {
        unit?.set({ cli_command: { result: "joined" } });
        return running;
      }
      return trackRunning(runInstall(unit));
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
      clearTimeout(retryTimer);
      retryTimer = undefined;
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
