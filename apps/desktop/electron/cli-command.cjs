const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const {
  createReleaseAssetPipeline,
  MAX_DOWNLOAD_BYTES,
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

/** An install that stopped on purpose: its event ends `refused`. */
class CliInstallRefusal extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}
const refusal = (reason, message) => new CliInstallRefusal(reason, message);

/**
 * @param {{
 *   fetch: (url: string, init?: any) => Promise<any>,
 *   fs: typeof import("node:fs/promises"),
 *   exec: (file: string, args: string[], options?: { timeout?: number, env?: Record<string, string | undefined> }) => Promise<{ stdout: string | Buffer }>,
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

  let distroNames = [];
  let distroReadAt = -Infinity;
  let distroRead;
  const wslStates = new Map();
  const wslExe = path.win32.join(
    env.SystemRoot || "C:\\Windows",
    "System32",
    "wsl.exe",
  );

  async function listDistros() {
    if (now() - distroReadAt < 30_000) return;
    distroRead ??= (async () => {
      try {
        const { stdout } = await exec(wslExe, ["--list", "--quiet"], {
          timeout: VERSION_CHECK_TIMEOUT_MS,
          env: { ...env, WSL_UTF8: "1" },
        });
        const bytes = Buffer.isBuffer(stdout)
          ? stdout
          : Buffer.from(
              stdout,
              String(stdout).includes("\0") ? "binary" : "utf8",
            );
        const text = bytes.includes(0)
          ? bytes.toString("utf16le")
          : bytes.toString("utf8");
        distroNames = [
          ...new Set(
            text
              .replace(/^\uFEFF/, "")
              .split(/\r?\n/)
              .map((name) => name.trim())
              .filter(
                (name) => name && !/^docker-desktop(?:-data)?$/i.test(name),
              ),
          ),
        ];
      } catch {
        distroNames = [];
      }
      distroReadAt = now();
    })();
    try {
      await distroRead;
    } finally {
      distroRead = null;
    }
  }

  async function wslFields(record) {
    if (
      platform !== "win32" ||
      arch !== "x64" ||
      !record ||
      !distroNames.length
    )
      return {};
    return {
      wsl: {
        version: record.wsl?.version,
        distros: distroNames.map((name) => ({
          name,
          status: record.wsl?.distros?.includes(name) ? "added" : "not-added",
          progress: null,
          error: null,
          ...wslStates.get(name),
        })),
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
    const wsl = await wslFields(record);
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
        const digests = previous.digests ?? {};
        if (!previous.digests) {
          for (const name of [binary, "share"])
            digests[name] = await contentDigest(targetOf(name));
        }
        marker = targetOf(`.pending-${randomUUID()}.json`);
        await writeAtomically(marker, JSON.stringify({ digests }));
        await fs.rm(paths.recordFile, { force: true });
      }
      await reconcileDisk(true);
      newlyInstalled = false;
      transient = null;
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

  async function runAddWsl(distro, unit) {
    let staging;
    let target;
    let created = false;
    let createdFolder = false;
    let createdLocal = false;
    let swapped = false;
    let committed = false;
    const id = randomUUID();
    const publish = async (phase, progress = null) => {
      wslStates.set(distro, { status: "adding", phase, progress, error: null });
      emit(await settledState());
    };
    const run = (program, args) =>
      exec(wslExe, ["-d", distro, "--exec", program, ...args], {
        timeout: VERSION_CHECK_TIMEOUT_MS,
        env,
      });
    try {
      if (
        unsupportedReason ||
        platform !== "win32" ||
        arch !== "x64" ||
        quitting.signal.aborted
      )
        return settledState();
      await listDistros();
      if (!distroNames.includes(distro))
        throw refusal("unknown_distro", "Not added.");
      await reconcileDisk();
      const record = await readRecord();
      if (!record) throw refusal("not_installed", "Not installed.");

      await publish("downloading", 0);
      let digests = record.wsl?.digests;
      if (record.wsl?.version !== appVersion) {
        if (!record.wsl && (await exists(targetOf("linux"))))
          throw refusal(
            "foreign_command",
            `There's already an ajour in ${paths.installDir} that Ajour didn't install. Remove it, then install again.`,
          );
        staging = targetOf(`.staging-${id}`);
        await fs.mkdir(staging);
        const asset = `ajour-${appVersion}-linux-x64.tar.gz`;
        const pipeline = createReleaseAssetPipeline({
          fetch,
          fs,
          exec,
          paths,
          asset,
          binary: "ajour",
          appVersion,
          label: "Linux",
          arch: "x64",
          development,
          releaseOrigin,
          signal: quitting.signal,
          onProgress: (percent) => {
            void publish("downloading", percent);
          },
        });
        const resolved = await pipeline.resolveAsset({});
        const archive = path.join(staging, asset);
        await pipeline.download(resolved, archive);
        await publish("checking");
        const unpacked = path.join(staging, "unpacked");
        await pipeline.unpack(archive, unpacked);
        const share = path.join(unpacked, "share");
        await fs.mkdir(share, { recursive: true });
        for (const name of ["man", "completions"]) {
          if (await exists(path.join(unpacked, name)))
            await fs.rename(path.join(unpacked, name), path.join(share, name));
        }
        digests = { linux: await contentDigest(unpacked) };
        await writeAtomically(
          targetOf(`.pending-${id}.json`),
          JSON.stringify({ digests }),
        );
        swapped = true;
        if (await exists(targetOf("linux")))
          await fs.rename(targetOf("linux"), asideOf("linux", id));
        await fs.rename(unpacked, targetOf("linux"));
      }
      await publish("checking");
      target = String(
        (await run("wslpath", ["-u", path.join(targetOf("linux"), "ajour")]))
          .stdout,
      ).trim();
      if (
        !target.startsWith("/") ||
        target.includes("\n") ||
        target.includes("\0")
      )
        throw refusal(
          "wrong_version",
          "Ajour couldn't unpack the ajour archive.",
        );
      let output;
      try {
        output = String((await run(target, ["-V"])).stdout).trim();
      } catch {
        throw refusal(
          "wrong_version",
          "The downloaded ajour didn't print its version within 10 seconds, so Ajour didn't install it.",
        );
      }
      if (output !== `ajour ${appVersion}`)
        throw refusal(
          "wrong_version",
          `The downloaded ajour says "${output.slice(0, 80)}", not "ajour ${appVersion}", so Ajour didn't install it.`,
        );
      await publish("linking");
      const script =
        'link="$HOME/.local/bin/ajour"; if [ -L "$link" ] && [ "$(readlink "$link")" = "$1" ]; then exit 0; fi; if [ -e "$link" ] || [ -L "$link" ]; then exit 17; fi; made=0; localmade=0; if [ ! -d "$HOME/.local" ]; then localmade=1; fi; if [ ! -d "$HOME/.local/bin" ]; then made=1; fi; if ! { mkdir -p "$HOME/.local/bin" && ln -s "$1" "$link"; }; then if [ "$made" = 1 ]; then rmdir "$HOME/.local/bin" 2>/dev/null; fi; if [ "$localmade" = 1 ]; then rmdir "$HOME/.local" 2>/dev/null; fi; exit 1; fi; printf "created:%s:%s" "$made" "$localmade"';
      try {
        const result = await run("sh", ["-c", script, "sh", target]);
        created = String(result.stdout).startsWith("created");
        createdFolder = String(result.stdout).split(":")[1] === "1";
        createdLocal = String(result.stdout).split(":")[2] === "1";
      } catch (error) {
        if (error.code === 17)
          throw refusal(
            "foreign_command",
            `Another ajour is at ~/.local/bin/ajour in ${distro}. Remove it, then add again.`,
          );
        throw error;
      }
      const loginPath = String(
        (await run("sh", ["-lc", 'printf "%s" "$HOME/.local/bin\n$PATH"']))
          .stdout,
      ).split("\n");
      const onPath =
        loginPath.length === 2
          ? loginPath[1].split(":").includes(loginPath[0])
          : loginPath[0].includes("/.local/bin");
      if (
        record.wsl?.version !== appVersion ||
        !record.wsl?.distros.includes(distro)
      )
        await writeRecord({
          ...record,
          wsl: {
            version: appVersion,
            digests,
            distros: [...new Set([...(record.wsl?.distros ?? []), distro])],
          },
        });
      committed = true;
      wslStates.set(distro, {
        status: "added",
        progress: null,
        error: null,
        hint: onPath
          ? `Open a new ${distro} terminal to use it.`
          : `Add ~/.local/bin to your PATH in ${distro}.`,
      });
      unit?.set({ cli_command: { result: "installed" } });
    } catch (error) {
      if (created && !committed) {
        await run("sh", [
          "-c",
          'link="$HOME/.local/bin/ajour"; if [ -L "$link" ] && [ "$(readlink "$link")" = "$1" ]; then rm -- "$link"; fi; if [ "$2" = 1 ]; then rmdir "$HOME/.local/bin"; fi; if [ "$3" = 1 ]; then rmdir "$HOME/.local"; fi',
          "sh",
          target,
          createdFolder ? "1" : "0",
          createdLocal ? "1" : "0",
        ]).catch(() => undefined);
      }
      wslStates.set(distro, {
        status: "error",
        progress: null,
        error: error.message,
      });
      if (error.reason) unit?.refuse(error.reason);
      else
        unit?.fail(new Error("Ajour couldn't install ajour."), {
          reason: "wsl_add_failed",
        });
      unit?.set({
        cli_command: { result: error.reason ? "refused" : "failed" },
      });
    } finally {
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
    /** @param {string} distro @param {{ unit?: any }} [options] */
    addWsl(distro, { unit } = {}) {
      const before = running;
      return trackRunning(
        (async () => {
          if (before) await before;
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

    async state() {
      if (
        !unsupportedReason &&
        platform === "win32" &&
        arch === "x64" &&
        (await readRecord())
      )
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
