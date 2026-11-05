const { createHash } = require("node:crypto");
const path = require("node:path");
const { tagForPackageVersion } = require("./update-check.cjs");

/**
 * The release asset steps of the ajour command (#604): find the asset of the
 * app's release on GitHub, download it within its published size, check its
 * SHA-256 and unpack it. The Windows and macOS install and the Linux build
 * for WSL take them with their asset's name and binary.
 */

const GITHUB_REPOSITORY = "les-cabochons/ajour";
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_ORIGIN = "https://github.com";
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;
const LOOKUP_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const TAR_TIMEOUT_MS = 60_000;
const DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;
const MAX_REDIRECTS = 5;

/**
 * The local fake release a development build installs from, for tests and
 * the real-app check, or null: a packaged build always installs from GitHub.
 */
function localReleaseOrigin(development, releaseOrigin) {
  return development && typeof releaseOrigin === "string" && releaseOrigin
    ? releaseOrigin.replace(/\/+$/, "")
    : null;
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
 *   exec: (file: string, args: string[], options?: { timeout?: number }) => Promise<{ stdout: string | Buffer }>,
 *   paths: { tar: string },
 *   asset: string,
 *   binary: string,
 *   appVersion: string,
 *   label: string,
 *   arch: string,
 *   localOrigin?: string | null,
 *   signal: AbortSignal,
 *   onProgress?: (percent: number) => void,
 * }} options
 */
function createReleaseAssetPipeline({
  fetch,
  fs,
  exec,
  paths,
  asset,
  binary,
  appVersion,
  label,
  arch,
  localOrigin = null,
  signal,
  onProgress = (_percent) => {},
}) {
  const apiOrigin = localOrigin ?? GITHUB_API_ORIGIN;
  const downloadOrigin = localOrigin ?? GITHUB_ORIGIN;
  const tag = tagForPackageVersion(appVersion);
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
        `The ${tag} release has no ajour for ${label} ${arch} yet. Try again in a few minutes.`,
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
          signal,
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
        onProgress(percent);
      }
    };
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        signal.throwIfAborted();
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

  return { resolveAsset, download, unpack, sha256Of };
}
module.exports = {
  CliInstallRefusal,
  createReleaseAssetPipeline,
  localReleaseOrigin,
  MAX_DOWNLOAD_BYTES,
  refusal,
};
