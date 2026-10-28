// Reads plugin sources: git repositories with an `ajour.json` at their root.
// The format is in apps/docs/developers/plugin-source.md. Everything here runs
// in the main process: the renderer never fetches a source or a plugin file.
const { createHash, createPublicKey, verify } = require("node:crypto");
const zlib = require("node:zlib");

const OFFICIAL_PLUGIN_SOURCE_URL =
  "https://github.com/les-cabochons/ajour-plugins";
/**
 * The Ed25519 public keys, base64 of the raw 32 bytes, that may sign the
 * official source. A source signed by another key is refused. While the list
 * is empty, the official source is trusted on first use like any other.
 */
const OFFICIAL_SOURCE_PUBLIC_KEYS = Object.freeze([]);

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SIGNATURE_BYTES = 4 * 1024;
const MAX_PLUGIN_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_FILES = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_HOST_PROBE_BYTES = 64 * 1024;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PLUGIN_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SPDX_ID = /^[A-Za-z0-9.+-]{1,80}$/u;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const CAPABILITIES = new Set([
  "connector",
  "codeHost",
  "calendar",
  "team",
  "agentTask",
  "schema",
]);
const STATUSES = new Set(["available", "coming-soon", "deprecated"]);
const IMAGE_CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
};
const KNOWN_HOSTS = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "codeberg.org": "gitea",
};
const HOST_KINDS = new Set(["github", "gitlab", "gitea"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message) {
  throw new Error(message);
}

function assertExactKeys(value, allowed, required, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} has an unknown key "${key}".`);
  }
  for (const key of required) {
    if (!(key in value)) fail(`${label} is missing "${key}".`);
  }
  return value;
}

/**
 * @param {any} value
 * @param {string} label
 * @param {{ min?: number, max?: number, pattern?: RegExp }} [options]
 * @returns {string}
 */
function assertString(value, label, { min = 1, max = 500, pattern } = {}) {
  if (typeof value !== "string") fail(`${label} must be a string.`);
  if (value.length < min || value.length > max) {
    fail(`${label} must be ${min} to ${max} characters.`);
  }
  if (pattern && !pattern.test(value)) fail(`${label} is not valid.`);
  return value;
}

function assertHttpsUrl(value, label) {
  assertString(value, label, { max: 500 });
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a URL.`);
  }
  if (url.protocol !== "https:") fail(`${label} must use HTTPS.`);
  return value;
}

function assertSlugList(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    fail(`${label} must list 1 to 12 values.`);
  }
  value.forEach((item, index) =>
    assertString(item, `${label}[${index}]`, { max: 80, pattern: SLUG }),
  );
  if (new Set(value).size !== value.length) fail(`${label} repeats a value.`);
  return [...value];
}

/** A relative POSIX path with plain segments: no `.`, `..` or leading `/`. */
function assertRelativePath(value, label, { allowDot = false } = {}) {
  assertString(value, label, { max: 200 });
  if (allowDot && value === ".") return value;
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "." || segment === ".." || !PATH_SEGMENT.test(segment),
    )
  ) {
    fail(`${label} must be a relative path of plain segments.`);
  }
  return value;
}

function parseFileEntry(value, label) {
  const entry = assertExactKeys(
    value,
    ["path", "sha256", "size"],
    ["path", "sha256", "size"],
    label,
  );
  assertRelativePath(entry.path, `${label}.path`);
  assertString(entry.sha256, `${label}.sha256`, { max: 64, pattern: SHA256 });
  if (
    !Number.isInteger(entry.size) ||
    entry.size < 0 ||
    entry.size > MAX_PLUGIN_BYTES
  ) {
    fail(`${label}.size must be a whole number of bytes up to 25 MiB.`);
  }
  return { path: entry.path, sha256: entry.sha256, size: entry.size };
}

const PLUGIN_KEYS = [
  "id",
  "name",
  "description",
  "version",
  "pluginApiVersion",
  "capabilities",
  "features",
  "tags",
  "author",
  "license",
  "website",
  "status",
  "commit",
  "path",
  "files",
  "images",
];
const REQUIRED_PLUGIN_KEYS = [
  "id",
  "name",
  "description",
  "version",
  "pluginApiVersion",
  "capabilities",
  "features",
  "tags",
  "author",
  "license",
  "status",
];

function parsePluginEntry(value, index) {
  const label = `plugins[${index}]`;
  const raw = assertExactKeys(value, PLUGIN_KEYS, REQUIRED_PLUGIN_KEYS, label);
  const id = assertString(raw.id, `${label}.id`, {
    max: 64,
    pattern: PLUGIN_ID,
  });
  const at = `Plugin "${id}"`;
  const name = assertString(raw.name, `${at} name`, { max: 80 });
  const description = assertString(raw.description, `${at} description`, {
    max: 500,
  });
  const version = assertString(raw.version, `${at} version`, {
    max: 80,
    pattern: VERSION,
  });
  if (!Number.isInteger(raw.pluginApiVersion) || raw.pluginApiVersion < 1) {
    fail(`${at} pluginApiVersion must be a whole number of at least 1.`);
  }
  if (
    !Array.isArray(raw.capabilities) ||
    raw.capabilities.length < 1 ||
    raw.capabilities.length > 6 ||
    raw.capabilities.some((capability) => !CAPABILITIES.has(capability)) ||
    new Set(raw.capabilities).size !== raw.capabilities.length
  ) {
    fail(`${at} capabilities must list 1 to 6 known capabilities.`);
  }
  const author = assertExactKeys(
    raw.author,
    ["name", "url"],
    ["name", "url"],
    `${at} author`,
  );
  assertString(author.name, `${at} author name`, { max: 100 });
  assertHttpsUrl(author.url, `${at} author url`);
  const license = assertExactKeys(
    raw.license,
    ["name", "spdxId"],
    ["name", "spdxId"],
    `${at} license`,
  );
  assertString(license.name, `${at} license name`, { max: 80 });
  assertString(license.spdxId, `${at} license spdxId`, {
    max: 80,
    pattern: SPDX_ID,
  });
  if (raw.website !== undefined) assertHttpsUrl(raw.website, `${at} website`);
  if (!STATUSES.has(raw.status)) {
    fail(`${at} status must be available, coming-soon or deprecated.`);
  }

  const hasFiles = raw.files !== undefined;
  if (raw.status === "available" && !hasFiles) {
    fail(`${at} is available, so it must list its files.`);
  }
  if (raw.status === "coming-soon" && hasFiles) {
    fail(`${at} is coming soon, so it must not list files.`);
  }
  if ((hasFiles || raw.images !== undefined) && (!raw.commit || !raw.path)) {
    fail(`${at} must name the commit and path its files come from.`);
  }
  let commit;
  let pluginPath;
  if (raw.commit !== undefined || raw.path !== undefined) {
    commit = assertString(raw.commit, `${at} commit`, {
      max: 64,
      pattern: COMMIT,
    });
    pluginPath = assertRelativePath(raw.path, `${at} path`, { allowDot: true });
  }
  let files;
  if (hasFiles) {
    if (
      !Array.isArray(raw.files) ||
      raw.files.length < 1 ||
      raw.files.length > MAX_FILES
    ) {
      fail(`${at} must list 1 to ${MAX_FILES} files.`);
    }
    files = raw.files.map((file, fileIndex) =>
      parseFileEntry(file, `${at} files[${fileIndex}]`),
    );
    if (new Set(files.map((file) => file.path)).size !== files.length) {
      fail(`${at} lists a file twice.`);
    }
    if (!files.some((file) => file.path === "plugin.json")) {
      fail(`${at} must include plugin.json in its files.`);
    }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_PLUGIN_BYTES) fail(`${at} files are larger than 25 MiB.`);
  }
  let images;
  if (raw.images !== undefined) {
    const rawImages = assertExactKeys(
      raw.images,
      ["thumbnail", "hero"],
      [],
      `${at} images`,
    );
    images = {};
    for (const [role, image] of Object.entries(rawImages)) {
      const parsed = parseFileEntry(image, `${at} ${role} image`);
      const extension = parsed.path.slice(parsed.path.lastIndexOf("."));
      if (!IMAGE_CONTENT_TYPES[extension.toLowerCase()]) {
        fail(`${at} ${role} image must be PNG, JPEG, WebP or AVIF.`);
      }
      if (parsed.size > MAX_IMAGE_BYTES) {
        fail(`${at} ${role} image is larger than 1 MB.`);
      }
      images[role] = parsed;
    }
    if (Object.keys(images).length === 0) fail(`${at} images is empty.`);
  }

  return {
    id,
    name,
    description,
    version,
    pluginApiVersion: raw.pluginApiVersion,
    capabilities: [...raw.capabilities],
    features: assertSlugList(raw.features, `${at} features`),
    tags: assertSlugList(raw.tags, `${at} tags`),
    author: { name: author.name, url: author.url },
    license: { name: license.name, spdxId: license.spdxId },
    ...(raw.website !== undefined ? { website: raw.website } : {}),
    status: raw.status,
    ...(commit ? { commit, path: pluginPath } : {}),
    ...(files ? { files } : {}),
    ...(images ? { images } : {}),
  };
}

/**
 * Parses and checks an `ajour.json`, given its exact bytes. With
 * `skipInvalidPlugins`, a plugin entry this Ajour cannot read, such as one
 * with a newer capability, is left out and named instead of failing the
 * whole source.
 */
function parseSourceManifest(bytes, { skipInvalidPlugins = false } = {}) {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    fail("ajour.json is larger than 256 KiB.");
  }
  let raw;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("ajour.json is not valid JSON.");
  }
  const manifest = assertExactKeys(
    raw,
    ["schemaVersion", "name", "plugins"],
    ["schemaVersion", "name", "plugins"],
    "ajour.json",
  );
  if (manifest.schemaVersion !== 1) {
    fail("ajour.json uses a schema version this Ajour cannot read.");
  }
  const name = assertString(manifest.name, "ajour.json name", { max: 80 });
  if (
    !Array.isArray(manifest.plugins) ||
    manifest.plugins.length < 1 ||
    manifest.plugins.length > 100
  ) {
    fail("ajour.json must list 1 to 100 plugins.");
  }
  const plugins = [];
  const skippedPluginIds = [];
  manifest.plugins.forEach((raw, index) => {
    try {
      plugins.push(parsePluginEntry(raw, index));
    } catch (error) {
      if (!skipInvalidPlugins) throw error;
      skippedPluginIds.push(
        isRecord(raw) && typeof raw.id === "string"
          ? raw.id.slice(0, 64)
          : `#${index + 1}`,
      );
    }
  });
  if (new Set(plugins.map((plugin) => plugin.id)).size !== plugins.length) {
    fail("ajour.json lists a plugin id twice.");
  }
  return { schemaVersion: 1, name, plugins, skippedPluginIds };
}

function decodeBase64(value, label, byteLength) {
  assertString(value, label, { max: 200, pattern: BASE64 });
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength !== byteLength) {
    fail(`${label} must be ${byteLength} bytes.`);
  }
  return bytes;
}

/** Parses an `ajour.json.sig`. The public key comes back as raw bytes. */
function parseSourceSignature(bytes) {
  if (bytes.byteLength > MAX_SIGNATURE_BYTES) {
    fail("ajour.json.sig is too large.");
  }
  let raw;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("ajour.json.sig is not valid JSON.");
  }
  const signature = assertExactKeys(
    raw,
    ["schemaVersion", "algorithm", "publicKey", "signature"],
    ["schemaVersion", "algorithm", "publicKey", "signature"],
    "ajour.json.sig",
  );
  if (signature.schemaVersion !== 1 || signature.algorithm !== "ed25519") {
    fail("ajour.json.sig uses a format this Ajour cannot read.");
  }
  return {
    publicKey: decodeBase64(
      signature.publicKey,
      "ajour.json.sig publicKey",
      32,
    ),
    signature: decodeBase64(
      signature.signature,
      "ajour.json.sig signature",
      64,
    ),
  };
}

/** Whether `signature` signs the exact bytes of `manifestBytes`. */
function verifySourceSignature(manifestBytes, { publicKey, signature }) {
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
    format: "der",
    type: "spki",
  });
  return verify(null, Buffer.from(manifestBytes), key, signature);
}

/** The key's fingerprint as people compare it: `3f2a 9c1d 77e0 b4a2`. */
function keyFingerprint(publicKey) {
  const hex = createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
  return hex.match(/.{4}/gu).join(" ");
}

/**
 * The canonical form of a source URL: `https://host/owner/repo`, lowercase
 * host, no `.git`, no trailing slash. Anything else is refused.
 */
function normalizeSourceUrl(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    fail("Enter the repository's address.");
  }
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    fail("Enter the repository's full address, starting with https://.");
  }
  if (url.protocol !== "https:") fail("The repository must use HTTPS.");
  if (url.username || url.password) {
    fail("Remove the user name or password from the address.");
  }
  if (url.search || url.hash) fail("Remove the query or fragment.");
  const segments = url.pathname
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) {
    fail(
      "The address must name a repository, such as https://host/owner/repo.",
    );
  }
  if (
    segments.some(
      (segment) =>
        segment === "." || segment === ".." || !PATH_SEGMENT.test(segment),
    )
  ) {
    fail("The repository address has an unusual path.");
  }
  const portPart = url.port ? `:${url.port}` : "";
  return `https://${url.hostname.toLowerCase()}${portPart}/${segments.join("/")}`;
}

function isOfficialSourceUrl(url) {
  return url === OFFICIAL_PLUGIN_SOURCE_URL;
}

function sourceParts(url) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  return {
    origin: parsed.origin,
    host: parsed.host,
    repoPath: segments.join("/"),
    owner: segments.slice(0, -1).join("/"),
    repo: segments[segments.length - 1],
  };
}

function knownHostKind(url) {
  return KNOWN_HOSTS[new URL(url).hostname] ?? null;
}

function encodePath(filePath) {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

/** Where a host serves one file of the repository at `ref`. */
function rawFileUrl(source, ref, filePath) {
  const { origin, repoPath, owner, repo } = sourceParts(source.url);
  const file = encodePath(filePath);
  const at = encodeURIComponent(ref);
  switch (source.hostKind) {
    case "github":
      return `https://raw.githubusercontent.com/${owner}/${repo}/${at}/${file}`;
    case "gitlab":
      return `${origin}/${repoPath}/-/raw/${at}/${file}`;
    case "gitea":
      return COMMIT.test(ref)
        ? `${origin}/${repoPath}/raw/commit/${at}/${file}`
        : `${origin}/${repoPath}/raw/branch/${at}/${file}`;
    default:
      throw new Error("Ajour does not know how to read this repository.");
  }
}

/** The path of a plugin file inside the repository. */
function repositoryPath(pluginPath, filePath) {
  return pluginPath === "." ? filePath : `${pluginPath}/${filePath}`;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function tooLarge(maximumBytes) {
  return Object.assign(
    new Error(`Download exceeds the ${maximumBytes}-byte limit.`),
    { code: "too_large" },
  );
}

async function readBoundedResponse(response, maximumBytes) {
  const contentLength = Number(response.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw tooLarge(maximumBytes);
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw tooLarge(maximumBytes);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw tooLarge(maximumBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchWithTimeout(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...options,
      headers: { "User-Agent": "Ajour-plugin-sources", ...options.headers },
      signal: controller.signal,
    });
    // A redirect may change the host, never the protocol.
    if (response.url && !String(response.url).startsWith("https://")) {
      throw new Error("A plugin source redirected away from HTTPS.");
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads sources over HTTPS. `fetchImpl` is injected so tests serve a fake
 * repository; the desktop passes Electron's `net.fetch`.
 */
function createSourceReader({ fetchImpl }) {
  function get(url, headers = {}) {
    return fetchWithTimeout(fetchImpl, url, { headers });
  }

  async function getBytes(url, maximumBytes) {
    const response = await get(url);
    if (!response.ok) {
      throw Object.assign(
        new Error(`The source answered HTTP ${response.status}.`),
        { status: response.status },
      );
    }
    return readBoundedResponse(response, maximumBytes);
  }

  async function probeJson(url) {
    try {
      const response = await get(url, { Accept: "application/json" });
      const body = response.ok
        ? JSON.parse(
            (
              await readBoundedResponse(response, MAX_HOST_PROBE_BYTES)
            ).toString("utf8"),
          )
        : undefined;
      return { status: response.status, body };
    } catch {
      return { status: 0, body: undefined };
    }
  }

  /** Which family of host serves the repository: GitHub, GitLab or Gitea. */
  async function detectHostKind(url) {
    const known = knownHostKind(url);
    if (known) return known;
    const { origin } = sourceParts(url);
    const gitea = await probeJson(`${origin}/api/v1/version`);
    if (gitea.status === 200 && typeof gitea.body?.version === "string") {
      return "gitea";
    }
    const gitlab = await probeJson(`${origin}/api/v4/version`);
    if (gitlab.status === 200 || gitlab.status === 401) return "gitlab";
    throw new Error(
      "Ajour can read plugin sources on GitHub, GitLab, and Gitea or Forgejo hosts such as Codeberg. This host is none of those.",
    );
  }

  /** The default branch, for hosts that need its name to serve a file. */
  async function defaultBranchRef(source) {
    if (source.hostKind === "github") return "HEAD";
    const { origin, repoPath, owner, repo } = sourceParts(source.url);
    const apiUrl =
      source.hostKind === "gitlab"
        ? `${origin}/api/v4/projects/${encodeURIComponent(repoPath)}`
        : `${origin}/api/v1/repos/${encodePath(owner)}/${encodeURIComponent(repo)}`;
    const project = await probeJson(apiUrl);
    const branch = project.body?.default_branch;
    if (typeof branch !== "string" || branch.length === 0) {
      throw new Error("The repository's default branch could not be read.");
    }
    return branch;
  }

  /**
   * Reads `ajour.json` and its signature from the default branch. A missing
   * signature (404) means unsigned; any other failure throws. A missing
   * `ajour.json` throws a message the person can act on, since a host also
   * answers 404 for a private or mistyped repository.
   */
  async function readListing(source) {
    const ref = await defaultBranchRef(source);
    let manifestBytes;
    try {
      manifestBytes = await getBytes(
        rawFileUrl(source, ref, "ajour.json"),
        MAX_MANIFEST_BYTES,
      );
    } catch (error) {
      throw error?.status === 404
        ? new Error(
            "Ajour found no ajour.json at the root of the repository's default branch. The address may be wrong, or the repository private.",
          )
        : error;
    }
    const signatureResponse = await get(
      rawFileUrl(source, ref, "ajour.json.sig"),
    );
    let signatureBytes = null;
    if (signatureResponse.ok) {
      signatureBytes = await readBoundedResponse(
        signatureResponse,
        MAX_SIGNATURE_BYTES,
      );
    } else if (signatureResponse.status !== 404) {
      throw new Error(
        `The source's signature answered HTTP ${signatureResponse.status}.`,
      );
    }
    return { manifestBytes, signatureBytes };
  }

  async function readVerifiedFile(source, commit, filePath, entry, maximum) {
    const mismatch = () =>
      new Error(`${entry.path} does not match the hash its source signed.`);
    let bytes;
    try {
      bytes = await getBytes(
        rawFileUrl(source, commit, filePath),
        Math.min(maximum, entry.size),
      );
    } catch (error) {
      // A file longer than its signed size is a changed file.
      throw error?.code === "too_large" ? mismatch() : error;
    }
    if (bytes.byteLength !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      throw mismatch();
    }
    return bytes;
  }

  /** Every file of a plugin, at its commit, each checked against its hash. */
  async function readPluginFiles(source, plugin) {
    if (!plugin.files || !plugin.commit) {
      throw new Error(`${plugin.name} has no files to install.`);
    }
    const files = [];
    for (const entry of plugin.files) {
      files.push({
        path: entry.path,
        bytes: await readVerifiedFile(
          source,
          plugin.commit,
          repositoryPath(plugin.path, entry.path),
          entry,
          MAX_PLUGIN_BYTES,
        ),
      });
    }
    return files;
  }

  /** A plugin's artwork as a data URL, checked against its hash. */
  async function readImage(source, plugin, role) {
    const entry = plugin.images?.[role];
    if (!entry) return undefined;
    const bytes = await readVerifiedFile(
      source,
      plugin.commit,
      repositoryPath(plugin.path, entry.path),
      entry,
      MAX_IMAGE_BYTES,
    );
    const extension = entry.path
      .slice(entry.path.lastIndexOf("."))
      .toLowerCase();
    return `data:${IMAGE_CONTENT_TYPES[extension]};base64,${bytes.toString("base64")}`;
  }

  return { detectHostKind, readListing, readPluginFiles, readImage };
}

/**
 * Decides how far Ajour trusts a listing, from its bytes and what Ajour
 * pinned before. `pinnedPublicKey` is base64; `officialKeys` too.
 *
 * - `signed`: verified with the pinned or an official key.
 * - `unsigned`: no signature, and none was ever expected.
 * - `untrusted_key`: verified, but with a key the person has not approved.
 * - `key_changed`: verified with a key other than the pinned one. Blocked.
 * - `signature_missing`: a pinned or official source lost its signature. Blocked.
 * - `bad_signature`: the signature does not match the bytes. Blocked.
 */
function assessSourceTrust({
  manifestBytes,
  signatureBytes,
  pinnedPublicKey,
  official,
  officialKeys = OFFICIAL_SOURCE_PUBLIC_KEYS,
}) {
  const expectsSignature =
    Boolean(pinnedPublicKey) || (official && officialKeys.length > 0);
  if (!signatureBytes) {
    return expectsSignature
      ? { state: "signature_missing", signed: false }
      : { state: "unsigned", signed: false };
  }
  let parsed;
  try {
    parsed = parseSourceSignature(signatureBytes);
  } catch {
    return { state: "bad_signature", signed: false };
  }
  if (!verifySourceSignature(manifestBytes, parsed)) {
    return { state: "bad_signature", signed: false };
  }
  const publicKey = parsed.publicKey.toString("base64");
  const fingerprint = keyFingerprint(parsed.publicKey);
  if (official && officialKeys.length > 0) {
    return officialKeys.includes(publicKey)
      ? { state: "signed", signed: true, publicKey, fingerprint }
      : { state: "key_changed", signed: false, publicKey, fingerprint };
  }
  if (!pinnedPublicKey) {
    return { state: "untrusted_key", signed: false, publicKey, fingerprint };
  }
  return pinnedPublicKey === publicKey
    ? { state: "signed", signed: true, publicKey, fingerprint }
    : { state: "key_changed", signed: false, publicKey, fingerprint };
}

/** States in which Ajour lists no plugin of the source. */
const BLOCKED_TRUST_STATES = new Set([
  "key_changed",
  "signature_missing",
  "bad_signature",
]);

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function tarHeader(filePath, size) {
  const header = Buffer.alloc(512);
  let name = filePath;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    // ustar keeps a long path as a prefix of up to 155 bytes and a name of up
    // to 100, split at a slash: take the first slash that fits both.
    const split = [...filePath.matchAll(/\//gu)]
      .map((match) => match.index)
      .find(
        (index) =>
          Buffer.byteLength(filePath.slice(index + 1)) <= 100 &&
          Buffer.byteLength(filePath.slice(0, index)) <= 155,
      );
    if (split === undefined) {
      throw new Error(`The path ${filePath} is too long to package.`);
    }
    prefix = filePath.slice(0, split);
    name = filePath.slice(split + 1);
  }
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(size, 12), 124, 12, "ascii");
  header.write(octal(0, 12), 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write(prefix, 345, 155, "utf8");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

/**
 * Packs verified files into the `.ajour-connector` format the installer
 * already checks: a gzipped tar of regular files, paths relative to the
 * plugin's folder.
 */
function createPluginArchive(files) {
  const parts = [];
  for (const file of files) {
    assertRelativePath(file.path, "File path");
    const bytes = Buffer.from(file.bytes);
    parts.push(tarHeader(file.path, bytes.byteLength), bytes);
    const padding = (512 - (bytes.byteLength % 512)) % 512;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

module.exports = {
  BLOCKED_TRUST_STATES,
  HOST_KINDS,
  MAX_MANIFEST_BYTES,
  OFFICIAL_PLUGIN_SOURCE_URL,
  OFFICIAL_SOURCE_PUBLIC_KEYS,
  assessSourceTrust,
  createPluginArchive,
  createSourceReader,
  isOfficialSourceUrl,
  keyFingerprint,
  knownHostKind,
  normalizeSourceUrl,
  parseSourceManifest,
  parseSourceSignature,
  rawFileUrl,
  readBoundedResponse,
  repositoryPath,
  sourceParts,
  verifySourceSignature,
};
