const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const {
  CliInstallRefusal,
  createReleaseAssetPipeline,
  localReleaseOrigin,
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
  // Installed only as the Linux build for WSL (#604).
  linux: { os: "linux", label: "Linux", extension: "tar.gz" },
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

/** The install folder's entry that holds the Linux build for WSL. */
const LINUX_ENTRY = "linux";
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

/**
 * Removes `~/.local/bin/ajour` only while it links to "$1", then the folders
 * an Add made ("$2", "$3"; 0 on Remove). Anything else there stays. A link
 * that can't be removed exits 1.
 */
const UNLINK_SCRIPT = [
  'link="$HOME/.local/bin/ajour"',
  'if [ -L "$link" ] && [ "$(readlink "$link")" = "$1" ]; then rm -f -- "$link" || exit 1; fi',
  'if [ "$2" = 1 ]; then rmdir "$HOME/.local/bin" 2>/dev/null; fi',
  'if [ "$3" = 1 ]; then rmdir "$HOME/.local" 2>/dev/null; fi',
  "exit 0",
].join("; ");

/** The login shell's HOME and PATH, last, after anything its profile prints. */
const LOGIN_PATH_SCRIPT = 'printf "\\n%s\\n%s\\n" "$HOME" "$PATH"';

/** Why a WSL 1 distro has no Add, and how to convert it (#611). */
function wsl1Sentence(distro) {
  return `WSL 1 isn't supported. Convert it with: wsl --set-version ${distro} 2`;
}

/** What Remove says about the WSL links it couldn't delete (#605). */
function linksLeftSentence(distros) {
  const names = new Intl.ListFormat("en", { type: "conjunction" }).format(
    distros,
  );
  return `ajour was removed, but ~/.local/bin/ajour in ${names} couldn't be. It now points at nothing.`;
}

/** Why the Linux build kept its version: a running Linux ajour holds it (#606). */
const LINUX_BUSY = "An ajour running in WSL is using its files.";
/** How a rename fails on Windows while a file in the folder is open. */
const BUSY_CODES = ["EBUSY", "EPERM", "EACCES"];

const UNKNOWN_DISTRO =
  "Ajour can't find this distro in WSL's list any more. Reopen Settings to see the current list.";

/**
 * The distros `wsl.exe --list --verbose` printed, in UTF-8 or UTF-16LE: a
 * header, then NAME, STATE and VERSION, with `*` before the default distro.
 * WSL translates the header and STATE, so a row is any line ending in a
 * version; names have no spaces, a translated state may.
 * @returns {{ name: string, state: string, wslVersion: 1 | 2 }[]}
 */
function distrosOf(stdout) {
  const bytes = Buffer.isBuffer(stdout)
    ? stdout
    : Buffer.from(String(stdout), "utf8");
  // WSL answers in UTF-16LE unless it honours WSL_UTF8.
  const text = bytes.includes(0)
    ? bytes.toString("utf16le")
    : bytes.toString("utf8");
  const distros = new Map();
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const row = /^\s*\*?\s*(\S+)\s+(.*\S)\s+([12])\s*$/.exec(line);
    if (!row || DOCKER_DISTRO.test(row[1]) || distros.has(row[1])) continue;
    distros.set(row[1], {
      name: row[1],
      state: row[2],
      wslVersion: row[3] === "1" ? 1 : 2,
    });
  }
  return [...distros.values()];
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
  const localOrigin = localReleaseOrigin(development, releaseOrigin);
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
  /** After a Remove, the WSL links it couldn't delete, as a sentence. */
  let removalNotice = null;
  let running = null;
  let following = false;
  let retryTimer;
  let missingAttempts = 0;
  /** Set when a target of the follow running lacks its release asset. */
  let followMissing = false;
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
  /**
   * WSL's last list: its distros with their versions, or `ok: false` when
   * it failed (no WSL, or one that can't list). Never read at launch.
   * @type {{ ok: false } | { ok: true, distros: ReturnType<typeof distrosOf> }}
   */
  let distroList = { ok: true, distros: [] };
  let distroReadAt = -Infinity;
  let distroRead = null;
  /**
   * Per distro, an Add or Remove running (`adding`, `removing`), its failure
   * (`error`, with the `operation` that failed), or the hint of an
   * Add that succeeded in this launch. "Added" itself is the record's.
   */
  const wslStates = new Map();
  /**
   * The Linux build following the app (#606): `updating`, with the
   * download's percent, or its failure as a sentence. Null otherwise.
   * @type {null | { status: "updating", progress: number | null } | { status: "error", error: string }}
   */
  let wslFollow = null;
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
        const { stdout } = await exec(wslExe, ["--list", "--verbose"], {
          timeout: WSL_TIMEOUT_MS,
          env: { ...env, WSL_UTF8: "1" },
          encoding: "buffer",
        });
        distroList = { ok: true, distros: distrosOf(stdout) };
      } catch {
        // No WSL, or none it can list: no rows.
        distroList = { ok: false };
      }
      distroReadAt = now();
    })().finally(() => {
      distroRead = null;
    });
    await distroRead;
  }

  /** `distro` as WSL listed it last, or undefined. */
  function listedDistro(distro) {
    return distroList.ok
      ? distroList.distros.find(({ name }) => name === distro)
      : undefined;
  }

  /**
   * What Remove does in a recorded `distro`, from WSL's last list (#605):
   * `unlink` a listed one; `keep` the link when the list failed, since it
   * may still be there; `skip` one WSL no longer lists, as it's gone.
   * @returns {"unlink" | "keep" | "skip"}
   */
  function removalIn(distro) {
    if (!distroList.ok) return "keep";
    return listedDistro(distro) ? "unlink" : "skip";
  }

  /**
   * One distro's row. "Added" is the record's: an Add that fails on a
   * distro the record holds leaves it added, its link untouched.
   */
  function distroRow(record, { name, wslVersion }) {
    // The Linux ajour can't start in WSL 1 (#611).
    if (wslVersion === 1)
      return {
        name,
        wslVersion,
        status: "unsupported",
        reason: wsl1Sentence(name),
      };
    const added = record.wsl?.distros?.includes(name) ?? false;
    const live = wslStates.get(name);
    // The follow changes the build every added distro links to (#606).
    if (added && wslFollow?.status === "updating")
      return {
        name,
        wslVersion,
        status: "updating",
        progress: wslFollow.progress,
      };
    if (live?.status === "adding")
      return {
        name,
        wslVersion,
        status: "adding",
        phase: live.phase,
        progress: live.progress,
      };
    if (live?.status === "removing")
      return { name, wslVersion, status: "removing" };
    if (live?.status === "error")
      return {
        name,
        wslVersion,
        status: "error",
        error: live.error,
        added,
        operation: live.operation,
      };
    if (added && wslFollow?.status === "error" && linuxBehind(record))
      return {
        name,
        wslVersion,
        status: "error",
        error: wslFollow.error,
        added,
        operation: "follow",
      };
    if (!added) return { name, wslVersion, status: "not-added" };
    return {
      name,
      wslVersion,
      status: "added",
      ...(live?.hint ? { hint: live.hint } : {}),
    };
  }

  /** The `wsl` part of the state: one row per listed distro. */
  function wslFields(record) {
    if (
      !wslSupported ||
      !record ||
      !distroList.ok ||
      !distroList.distros.length
    )
      return {};
    return {
      wsl: {
        version: record.wsl?.version,
        // The version the Linux build follows to, also after it failed.
        ...(wslFollow && linuxBehind(record) ? { pending: appVersion } : {}),
        distros: distroList.distros.map((distro) => distroRow(record, distro)),
      },
    };
  }

  /** Whether the record's Linux build is another version than the app's. */
  function linuxBehind(record) {
    return Boolean(record?.wsl) && record.wsl.version !== appVersion;
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
      : {
          status: "not-installed",
          progress: null,
          error: null,
          ...(removalNotice ? { notice: removalNotice } : {}),
        };
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
      localOrigin,
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

  /** Releases store man/ and completions/ at the archive root: they go in share/. */
  async function moveIntoShare(unpacked) {
    const share = path.join(unpacked, "share");
    await fs.mkdir(share, { recursive: true });
    for (const name of ["man", "completions"]) {
      if (await exists(path.join(unpacked, name)))
        await fs.rename(path.join(unpacked, name), path.join(share, name));
    }
  }

  /**
   * Marks the swap `id` before it starts, with the digests of what it moves
   * in: until the record commits them, reconciliation takes them back out.
   */
  async function writePendingMarker(id, digests) {
    await writeAtomically(
      targetOf(`.pending-${id}.json`),
      JSON.stringify({ digests }),
    );
  }

  /** Moves `from` in as the entry `name`, the one there set aside for reconciliation. */
  async function swapIn(name, from, id) {
    if (await exists(targetOf(name)))
      await fs.rename(targetOf(name), asideOf(name, id));
    await fs.rename(from, targetOf(name));
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
    const entries = [binary, "share", LINUX_ENTRY];
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
      } else if (record && name !== LINUX_ENTRY) {
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
    // Each entry the record doesn't own is the user's, unless a fully written
    // pending marker names it with its content: an uncommitted swap's.
    const uncommitted = record
      ? entries.filter((name) => !Object.hasOwn(ownedDigests, name))
      : entries;
    for (const marker of names.filter((name) => PENDING_NAME.test(name))) {
      let pending;
      try {
        pending = JSON.parse(await fs.readFile(targetOf(marker), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
        throw error;
      }
      for (const name of uncommitted) {
        const expected = pending?.digests?.[name];
        if (
          typeof expected === "string" &&
          /^[0-9a-f]{64}$/.test(expected) &&
          (await contentDigest(targetOf(name))) === expected
        )
          await fs.rm(targetOf(name), { recursive: true, force: true });
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
      (await exists(targetOf(LINUX_ENTRY)))
    ) {
      throw refusal(
        "foreign_command",
        `There's already an ajour in ${paths.installDir} that Ajour didn't install. Remove it, then install again.`,
      );
    }
  }

  async function runInstall(unit, follow = false, interactive = !follow) {
    const report = { platform, arch, version: appVersion };
    // A follow names its build; the Linux one follows on its own (#606).
    if (follow) report.target = PLATFORM_NAMES[platform].os;
    const started = now();
    const id = randomUUID();
    let staging;
    let swapped = false;
    let committed = false;
    let linkAdded = false;
    removalNotice = null;
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
      await moveIntoShare(unpacked);
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
      await writePendingMarker(id, digests);
      swapped = true;
      for (const name of [binary, "share"])
        await swapIn(name, path.join(unpacked, name), id);
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
      if (follow && error.reason === "missing_asset") followMissing = true;
    } finally {
      unit?.set({ cli_command: report });
    }
    const state = await settledState();
    // A follow reports its end once its retry, if any, is queued.
    if (!follow) emit(state);
    return state;
  }

  async function runRemove(unit) {
    let previous;
    let marker;
    /** `wsl_links_left`, once the recorded distros' links were tried. */
    let wslReport = {};
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
        // The Linux build for WSL goes with the command. Its links go after,
        // once nothing of the command is left for them to point at.
        Object.assign(digests, previous.wsl?.digests);
        marker = targetOf(`.pending-${randomUUID()}.json`);
        await writeAtomically(marker, JSON.stringify({ digests }));
        await fs.rm(paths.recordFile, { force: true });
      }
      let cleanup;
      try {
        await reconcileDisk(true);
      } catch (error) {
        cleanup = error;
      }
      // The deleted record commits the removal, and nothing on disk names
      // the distros after it: their links go now, even when reconcile
      // failed, which Retry repeats from disk. A cancelled prompt restores
      // the record, so its links stay.
      if (cleanup?.reason === "admin_cancelled") throw cleanup;
      const recorded = previous?.wsl?.distros ?? [];
      if (recorded.length) {
        const left = await unlinkAll(recorded);
        removalNotice = left.length ? linksLeftSentence(left) : null;
        wslReport = { wsl_links_left: left.length };
      }
      if (cleanup) throw cleanup;
      newlyInstalled = false;
      transient = null;
      wslStates.clear();
      wslFollow = null;
      unit?.set({ cli_command: { result: "removed", ...wslReport } });
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
        cli_command: {
          result: error.reason ? "refused" : "failed",
          ...wslReport,
        },
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
   * The path inside `distro` of `file`, by default the Linux build's binary,
   * from `wslpath -u`: the mount root can be `/mnt/c`, `/c` or custom. The
   * file needn't exist.
   */
  async function linuxTargetIn(
    distro,
    file = path.join(targetOf(LINUX_ENTRY), binaryName("linux")),
  ) {
    const target = (await inDistro(distro, "wslpath", ["-u", file])).trim();
    if (!target.startsWith("/") || /[\n\0]/.test(target))
      throw new Error(
        `Ajour couldn't find its folder in ${distro}. Check that WSL can reach your Windows drive.`,
      );
    return target;
  }

  /** Removes `~/.local/bin/ajour` from `distro` while it links to our build. */
  async function unlinkFrom(distro) {
    const target = await linuxTargetIn(distro);
    await inDistro(distro, "sh", ["-c", UNLINK_SCRIPT, "sh", target, "0", "0"]);
  }

  /**
   * For removing the command (#605): each recorded distro's link, best
   * effort, once the record and `bin\linux` are gone. A distro WSL no longer
   * lists has no link left and is skipped. Returns the distros whose link
   * may remain.
   */
  async function unlinkAll(distros) {
    if (!wslSupported) return [...distros];
    await listDistros({ fresh: true });
    const left = [];
    for (const distro of distros) {
      const removal = removalIn(distro);
      if (removal === "keep") left.push(distro);
      else if (removal === "unlink")
        await unlinkFrom(distro).catch(() => left.push(distro));
    }
    return left;
  }

  /**
   * Downloads and unpacks the Linux build into `staging`, through the
   * shared pipeline. Returns the unpacked build and its digest.
   */
  async function stageLinux(staging, publish, report = {}) {
    const linuxAsset = cliAssetName("linux", "x64", appVersion);
    const pipeline = createReleaseAssetPipeline({
      fetch,
      fs,
      exec,
      paths,
      asset: linuxAsset,
      binary: binaryName("linux"),
      appVersion,
      label: PLATFORM_NAMES.linux.label,
      arch: "x64",
      localOrigin,
      signal: quitting.signal,
      onProgress: (percent) => void publish("downloading", percent),
    });
    await publish("downloading", 0);
    const resolved = await pipeline.resolveAsset(report);
    const archive = path.join(staging, linuxAsset);
    await pipeline.download(resolved, archive);
    await publish("checking");
    const unpacked = path.join(staging, "unpacked");
    await pipeline.unpack(archive, unpacked);
    await moveIntoShare(unpacked);
    return {
      unpacked,
      digests: { [LINUX_ENTRY]: await contentDigest(unpacked) },
    };
  }

  /**
   * Swaps a staged Linux build into `bin\linux` as the Windows files are: a
   * pending marker first, the old build set aside. Until the record commits
   * it, reconciliation takes it back out.
   */
  async function swapLinuxIn(id, { unpacked, digests }) {
    stopIfQuitting();
    await writePendingMarker(id, digests);
    await swapIn(LINUX_ENTRY, unpacked, id);
  }

  /**
   * `swapLinuxIn`, again after 50 ms, doubling up to 800 ms, while a rename
   * fails as Windows fails one on a folder still in use. Right after `-V`
   * ran the staged build through `/mnt/c`, Windows holds its folder for a
   * moment (under 300 ms, measured on WSL 2). A running Linux ajour holds
   * `bin\linux` for as long as it runs: that still fails, about 1.5 s on.
   * A retry finishes a swap half done: `swapIn` skips an entry set aside.
   */
  async function swapLinuxInPatiently(id, staged) {
    for (let wait = 50; ; wait *= 2) {
      try {
        return await swapLinuxIn(id, staged);
      } catch (error) {
        if (!BUSY_CODES.includes(error?.code) || wait > 800) throw error;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  /**
   * Checks inside `distro` that the Linux build at `target` prints the
   * app's version. `ending` closes each refusal's sentence.
   */
  async function checkLinuxVersion(distro, target, ending) {
    let printed;
    try {
      printed = (
        await inDistro(distro, target, ["-V"], VERSION_CHECK_TIMEOUT_MS)
      ).trim();
    } catch (error) {
      throw refusal(
        "wrong_version",
        error.timedOut
          ? `The downloaded ajour didn't print its version within 10 seconds${ending}`
          : `The downloaded ajour didn't start in ${distro}${ending}`,
      );
    }
    if (printed !== `ajour ${appVersion}`)
      throw refusal(
        "wrong_version",
        `The downloaded ajour says "${printed.slice(0, 80)}", not "ajour ${appVersion}"${ending}`,
      );
  }

  /**
   * Lets go of the Linux build: the record loses `wsl`, and reconcile,
   * finding `bin\linux` named with its content by the marker, deletes it.
   */
  async function dropWsl(record) {
    await writePendingMarker(randomUUID(), {
      [LINUX_ENTRY]: record.wsl.digests?.[LINUX_ENTRY],
    });
    const { wsl: _dropped, ...withoutWsl } = record;
    await writeRecord(withoutWsl);
    wslFollow = null;
    await reconcileDisk();
  }

  /** Ends a WSL Add's or Remove's event `refused`, with `reason`. */
  function refuseWsl(unit, reason) {
    unit?.refuse(reason);
    unit?.set({ cli_command: { result: "refused" } });
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
    if (!listedDistro(distro)) await listDistros({ fresh: true });
    const listed = listedDistro(distro);
    if (!listed) {
      refuseWsl(unit, "unknown_distro");
      throw refusal("unknown_distro", UNKNOWN_DISTRO);
    }
    // The Linux ajour can't start in WSL 1 (#611): nothing is downloaded or
    // run, and the row keeps its sentence. Not thrown: it names the distro.
    if (listed.wslVersion === 1) {
      refuseWsl(unit, "wsl1_unsupported");
      return settledState();
    }
    const id = randomUUID();
    let staging;
    let swapped = false;
    let committed = false;
    /** The link this Add made, and the folders it made for it. */
    let made = null;
    const publish = async (phase, progress = null) => {
      wslStates.set(distro, { status: "adding", phase, progress });
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
      let digests = record.wsl?.digests;
      // A second distro, or the same one again, reuses this version's build.
      if (record.wsl?.version !== appVersion) {
        if (!record.wsl && (await exists(targetOf(LINUX_ENTRY))))
          throw refusal(
            "foreign_command",
            `There's already an ajour in ${targetOf(LINUX_ENTRY)} that Ajour didn't install. Remove it, then add again.`,
          );
        staging = targetOf(`.staging-${id}`);
        await fs.mkdir(staging);
        swapped = true;
        const staged = await stageLinux(staging, publish);
        await swapLinuxIn(id, staged);
        digests = staged.digests;
      }

      await publish("checking");
      const target = await linuxTargetIn(distro);
      await checkLinuxVersion(distro, target, ", so Ajour didn't add it.");

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
      // An Add of this version finishes a follow that failed.
      wslFollow = null;
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
          : `Ajour couldn't add ajour to ${distro}.`;
      wslStates.set(distro, {
        status: "error",
        operation: "add",
        error: message,
      });
      // Never the message: it names the distro, and a path holds the user name.
      if (error.reason) refuseWsl(unit, error.reason);
      else {
        unit?.fail(new Error("Ajour couldn't add ajour to WSL."), {
          reason: "wsl_add_failed",
        });
        unit?.set({ cli_command: { result: "failed" } });
      }
    } finally {
      // Commits clean up their marker; a failure takes the build back out.
      if (swapped) await reconcileDisk().catch(() => undefined);
      if (staging) await removeQuietly(staging);
    }
    const state = await settledState();
    emit(state);
    return state;
  }

  /**
   * Removes the command from `distro` (#605): `~/.local/bin/ajour` only
   * while it links to our build, then the distro leaves the record, which
   * commits it. A distro WSL no longer lists is dropped without entering
   * it. With the last distro, the record loses `wsl` and reconcile deletes
   * `bin\linux`.
   */
  async function runRemoveWsl(distro, unit) {
    if (!wslSupported || quitting.signal.aborted) return settledState();
    // The cached list may be 30 seconds old.
    await listDistros({ fresh: true });
    const removal = removalIn(distro);
    const recorded = (await readRecord().catch(() => null))?.wsl?.distros;
    // The renderer passes a name: only one WSL lists or the record holds is used.
    if (removal !== "unlink" && !recorded?.includes(distro)) {
      refuseWsl(unit, "unknown_distro");
      throw refusal("unknown_distro", UNKNOWN_DISTRO);
    }
    try {
      wslStates.set(distro, { status: "removing" });
      emit(await settledState());
      if (reconciliation) await reconciliation;
      await reconcileDisk();
      initialized = true;
      const record = await readRecord();
      if (record?.wsl?.distros?.includes(distro)) {
        if (removal === "unlink") await unlinkFrom(distro);
        else if (removal === "keep")
          throw new Error(
            `Ajour couldn't run commands in ${distro}. Check that it starts, then try again.`,
          );
        const others = record.wsl.distros.filter((name) => name !== distro);
        if (others.length) {
          await writeRecord({
            ...record,
            wsl: { ...record.wsl, distros: others },
          });
        } else {
          await dropWsl(record);
        }
      }
      wslStates.delete(distro);
      unit?.set({ cli_command: { result: "removed" } });
    } catch (error) {
      wslStates.set(distro, {
        status: "error",
        operation: "remove",
        error:
          error instanceof Error && error.message
            ? error.message
            : `Ajour couldn't remove ajour from ${distro}.`,
      });
      // Never the message: it names the distro, and a path holds the user name.
      if (error.reason) refuseWsl(unit, error.reason);
      else {
        unit?.fail(new Error("Ajour couldn't remove ajour from WSL."), {
          reason: "wsl_remove_failed",
        });
        unit?.set({ cli_command: { result: "failed" } });
      }
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

  /**
   * Follows the Linux build for WSL to the app's version (#606), after
   * `ajour.exe`, and never touching it. The new build is checked inside the
   * first recorded distro WSL still lists, then swapped into `bin\linux`,
   * where every added distro's link finds it. A running Linux ajour holds
   * the files through `/mnt/c`: the rename fails, the old build keeps
   * working, and the next launch tries again. With no recorded distro left,
   * the record lets go of the build.
   */
  async function runFollowLinux(unit) {
    const report = {
      target: "linux",
      platform: "linux",
      arch: "x64",
      version: appVersion,
    };
    const started = now();
    const id = randomUUID();
    let staging;
    let swapped = false;
    let progress = null;
    const publish = async (_phase, percent) => {
      if (Number.isFinite(percent)) progress = percent;
      wslFollow = { status: "updating", progress };
      emit(await settledState());
    };
    try {
      if (reconciliation) await reconciliation;
      await reconcileDisk();
      initialized = true;
      const record = await readRecord();
      if (!linuxBehind(record)) {
        wslFollow = null;
        return;
      }
      // The follow is the newest word on the rows of its distros.
      for (const name of record.wsl.distros ?? [])
        if (wslStates.get(name)?.status === "error") wslStates.delete(name);
      await listDistros({ fresh: true });
      if (!distroList.ok)
        throw new Error("Ajour couldn't read the list of WSL distros.");
      const distro = (record.wsl.distros ?? []).find(listedDistro);
      if (!distro) {
        // Every distro it was added to is gone: nothing links to it.
        await dropWsl(record);
        report.result = "removed";
        return;
      }
      staging = targetOf(`.staging-${id}`);
      await fs.mkdir(staging);
      const staged = await stageLinux(staging, publish, report);
      report.download_ms = now() - started;
      // Checked before the swap, so a build that fails never replaces one
      // that works.
      await checkLinuxVersion(
        distro,
        await linuxTargetIn(distro, path.join(staged.unpacked, "ajour")),
        ".",
      );
      swapped = true;
      try {
        await swapLinuxInPatiently(id, staged);
      } catch (error) {
        if (BUSY_CODES.includes(error?.code))
          throw Object.assign(new Error(LINUX_BUSY), { busy: true });
        throw error;
      }
      await writeRecord({
        ...record,
        wsl: { ...record.wsl, version: appVersion, digests: staged.digests },
      });
      swapped = false;
      await reconcileDisk().catch(() => undefined);
      wslFollow = null;
      report.result = "installed";
    } catch (error) {
      const message = quitting.signal.aborted
        ? "Ajour quit before ajour was updated."
        : error instanceof Error && error.message
          ? error.message
          : "Ajour couldn't update ajour in WSL.";
      wslFollow = { status: "error", error: message };
      report.result = error.reason ? "refused" : "failed";
      if (error.reason) unit?.refuse(error.reason);
      // Never the message: it can name a distro or a path.
      else
        unit?.fail(new Error("Ajour couldn't update ajour in WSL."), {
          reason: error.busy ? "files_in_use" : "follow_failed",
        });
      if (error.reason === "missing_asset") followMissing = true;
    } finally {
      // A failure before the commit takes the new build back out.
      if (swapped) await reconcileDisk().catch(() => undefined);
      if (staging) await removeQuietly(staging);
      unit?.set({ cli_command: report });
    }
  }

  /** Runs one target's follow under its own `cli_command.follow` event. */
  async function followTarget(run) {
    const unit = events?.start("cli_command.follow", {
      kind: "job",
      trigger: "system",
      detached: true,
    });
    try {
      return await run(unit);
    } finally {
      unit?.end();
    }
  }

  /**
   * Follows only an existing install, through the same checks, without a
   * prompt: `ajour.exe` first, then the Linux build for WSL when the record
   * has one (#606). Neither waits on the other's outcome. A missing release
   * asset on either retries after 5 minutes, then hourly, on one timer.
   */
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
        const native =
          record && (record.version !== appVersion || transient?.pending);
        const linux = wslSupported && linuxBehind(record);
        if (!native && !linux) return settledState();
        followMissing = false;
        if (native) {
          await followTarget((unit) => runInstall(unit, true, interactive));
          // ajour.exe's outcome shows while the Linux build follows.
          if (linux) emit(await settledState());
        }
        if (linux) await followTarget(runFollowLinux);
        if (followMissing && !quitting.signal.aborted) {
          retryTimer = setTimeout(
            () => {
              retryTimer = undefined;
              void followAppVersion().catch(() => undefined);
            },
            retryDelay(missingAttempts++ === 0),
          );
          retryTimer.unref?.();
        } else if (!followMissing) missingAttempts = 0;
        const state = await settledState();
        emit(state);
        return state;
      })().finally(() => {
        following = false;
      }),
    );
  }

  return {
    followAppVersion,

    /**
     * Adds the command to the WSL distro `distro`, after the operation
     * running. Rejects only for a distro WSL doesn't list; a WSL 1 distro
     * is refused with its state unchanged (#611).
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

    /**
     * Removes the command from the WSL distro `distro`, after the operation
     * running. Rejects only for a distro neither WSL nor the record has.
     * @param {string} distro
     * @param {{ unit?: any }} [options] The event of the call that asked.
     */
    removeWsl(distro, { unit } = {}) {
      const before = running;
      return trackRunning(
        (async () => {
          if (before) await before.catch(() => undefined);
          return runRemoveWsl(distro, unit);
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
      // Retry of a failed follow. The WSL rows' Retry repeats the Linux
      // build's (#606), unless ajour.exe's own install failed: that goes first.
      if (transient?.pending || (wslFollow?.status === "error" && !transient))
        return followAppVersion(true);
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
