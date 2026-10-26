// @ts-check
const path = require("node:path");
const { createHash } = require("node:crypto");
const { readFile, realpath, stat } = require("node:fs/promises");
const { stripTypeScriptTypes } = require("node:module");

/**
 * The rules a plugin renderer is held to, apart from Electron itself, so
 * plain Node tests can check them (#390, decided in #231): which requests its
 * session lets through, which files its scheme serves and with what headers,
 * and which IPC sender is the plugin it claims to be.
 */

/** The scheme each plugin's origin, `ajour-plugin://<id>`, is on. */
const PLUGIN_SCHEME = "ajour-plugin";

/**
 * Where Ajour's own files sit in every plugin's origin: the host page, its
 * script, and the bootstrap the plugin's worker starts from. A plugin's
 * package can't replace them.
 */
const HOST_PATH_PREFIX = "/.ajour/";
const HOST_FILES = {
  "/.ajour/host.html": "host.html",
  "/.ajour/host.js": "host.js",
  "/.ajour/worker.js": "worker.js",
};
const HOST_PAGE_PATH = "/.ajour/host.html";

/**
 * Every file a plugin's origin serves carries this policy: scripts and
 * workers only from the plugin's own origin, no connection of any kind, no
 * frames, objects, forms or base address.
 */
const PLUGIN_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "worker-src 'self'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * A plugin's TypeScript source: main strips its types before serving it,
 * since the renderer has no Node to do it (#437).
 */
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".mts"]);

const JAVASCRIPT = "text/javascript; charset=utf-8";

/** The types a plugin's files are served as. Anything else is opaque bytes. */
const CONTENT_TYPES = {
  ".js": JAVASCRIPT,
  ".mjs": JAVASCRIPT,
  // Served stripped of their types, as JavaScript.
  ...Object.fromEntries(
    [...TYPESCRIPT_EXTENSIONS].map((extension) => [extension, JAVASCRIPT]),
  ),
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/** @param {string} pluginId */
function pluginOrigin(pluginId) {
  return `${PLUGIN_SCHEME}://${pluginId}`;
}

/** @param {string} pluginId */
function pluginPartition(pluginId) {
  // No `persist:` prefix: the session lives in memory and leaves nothing on disk.
  return `${PLUGIN_SCHEME}:${pluginId}`;
}

/** @param {string} pluginId */
function hostPageUrl(pluginId) {
  return `${pluginOrigin(pluginId)}${HOST_PAGE_PATH}`;
}

/** @param {string} url */
function parsedUrl(url) {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/**
 * Whether the plugin's session may make a request for `url`: only for the
 * plugin's own files, `ajour-plugin://<id>/`. Everything else is cancelled,
 * loopback and other plugins included.
 *
 * @param {string} url
 * @param {string} pluginId
 */
function pluginRequestAllowed(url, pluginId) {
  const parsed = parsedUrl(url);
  return (
    parsed !== undefined &&
    parsed.protocol === `${PLUGIN_SCHEME}:` &&
    parsed.host === pluginId &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

/**
 * What a request for `url` in the plugin's origin serves: one of Ajour's
 * own files, a file of the plugin's package by its path inside the
 * package, or nothing. No path leaves the package: no `..`, no encoded
 * separator, no drive, stream or NUL. Links are checked when served.
 *
 * @param {string} url
 * @param {string} pluginId
 * @param {string} packageDirectory
 * @returns {{ kind: "host", file: string } | { kind: "package", filePath: string } | { kind: "refused" }}
 */
function resolvePluginFile(url, pluginId, packageDirectory) {
  const parsed = parsedUrl(url);
  if (
    !parsed ||
    !pluginRequestAllowed(url, pluginId) ||
    !parsed.pathname.startsWith("/")
  ) {
    return { kind: "refused" };
  }
  if (parsed.pathname.startsWith(HOST_PATH_PREFIX)) {
    const file = Object.hasOwn(HOST_FILES, parsed.pathname)
      ? HOST_FILES[/** @type {keyof typeof HOST_FILES} */ (parsed.pathname)]
      : undefined;
    return file ? { kind: "host", file } : { kind: "refused" };
  }
  const segments = [];
  for (const raw of parsed.pathname.slice(1).split("/")) {
    let segment;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return { kind: "refused" };
    }
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      /[\\/:\0]/u.test(segment)
    ) {
      return { kind: "refused" };
    }
    segments.push(segment);
  }
  const root = path.resolve(packageDirectory);
  const filePath = path.resolve(root, ...segments);
  const relative = path.relative(root, filePath);
  if (
    segments.length === 0 ||
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return { kind: "refused" };
  }
  return { kind: "package", filePath };
}

/**
 * The headers every file of a plugin's origin carries: its type, the
 * policy, and no caching or sniffing. Only Ajour's own page is HTML: a
 * package file is never a page, whatever its name.
 *
 * @param {string} fileName
 * @param {"host" | "package" | "none"} [kind]
 */
function pluginFileHeaders(fileName, kind = "none") {
  const extension = path.extname(fileName).toLowerCase();
  return {
    "content-type": Object.hasOwn(CONTENT_TYPES, extension)
      ? CONTENT_TYPES[/** @type {keyof typeof CONTENT_TYPES} */ (extension)]
      : extension === ".html" && kind === "host"
        ? "text/html; charset=utf-8"
        : "application/octet-stream",
    "content-security-policy": PLUGIN_CONTENT_SECURITY_POLICY,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
  };
}

/** @param {string} child @param {string} parent */
function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/** At most this many stripped files are kept, as a package's file limit. */
const MAX_STRIPPED_FILES = 2_000;
/**
 * The largest TypeScript file main strips. Stripping is synchronous in the
 * main process: a file of 25 MB holds it for about 20 seconds.
 */
const MAX_TYPESCRIPT_SOURCE_BYTES = 2 * 1024 * 1024;
/** The longest reason Node gives that a reason quotes. */
const MAX_STRIP_REASON_CHARACTERS = 300;

/**
 * A TypeScript file's code with its types erased, or why it can't be, to
 * follow the file's name.
 *
 * @typedef {{ code: string, refused?: undefined } | { code?: undefined, refused: string }} StrippedFile
 */

/**
 * Each TypeScript file's stripped output, or why it can't be stripped, by
 * its real path, with the hash of the source it came from and the package
 * folder it was served from. An entry holds only for that exact source, so
 * a file that changes, even to the same size and time, is stripped again.
 * Entries last while the plugin's renderer is open.
 *
 * @type {Map<string, { hash: string, packageDirectory: string, stripped: StrippedFile }>}
 */
const strippedFiles = new Map();

/** Node's reason, on one line, ending as a sentence. @param {unknown} error */
function stripReason(error) {
  const message =
    error instanceof Error && typeof error.message === "string"
      ? error.message
      : "";
  const line =
    message
      .split(/\r?\n/u)
      .map((part) => part.trim())
      .find((part) => part !== "") ?? "Unknown error";
  const cut =
    line.length <= MAX_STRIP_REASON_CHARACTERS
      ? line
      : `${line.slice(0, MAX_STRIP_REASON_CHARACTERS - 1)}…`;
  return /[.!?…]$/u.test(cut) ? cut : `${cut}.`;
}

const sourceTooLarge = () => ({
  refused: "is over 2 MB, the most Ajour strips in a TypeScript file.",
});

/**
 * A TypeScript file's code with its types erased, or why it can't run:
 * only erasable syntax strips, and only a file of at most 2 MB. Enums,
 * namespaces and parameter properties would need code generated. Erasing
 * keeps every line and column, so a stack trace points into the source as
 * written.
 *
 * @param {string} realPath
 * @param {number} size
 * @param {string} packageDirectory the package folder, as the renderer knows it
 * @returns {Promise<StrippedFile>}
 */
async function strippedFile(realPath, size, packageDirectory) {
  if (size > MAX_TYPESCRIPT_SOURCE_BYTES) return sourceTooLarge();
  const bytes = await readFile(realPath);
  // The file may have grown since it was measured.
  if (bytes.length > MAX_TYPESCRIPT_SOURCE_BYTES) return sourceTooLarge();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const cached = strippedFiles.get(realPath);
  if (cached && cached.hash === hash) return cached.stripped;
  /** @type {StrippedFile} */
  let stripped;
  try {
    stripped = {
      code: stripTypeScriptTypes(bytes.toString("utf8"), { mode: "strip" }),
    };
  } catch (error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    stripped = {
      refused:
        code === "ERR_INVALID_TYPESCRIPT_SYNTAX"
          ? `isn't valid TypeScript: ${stripReason(error)}`
          : `uses TypeScript that Ajour can't strip: ${stripReason(error)}`,
    };
  }
  strippedFiles.delete(realPath);
  strippedFiles.set(realPath, { hash, packageDirectory, stripped });
  if (strippedFiles.size > MAX_STRIPPED_FILES) {
    const oldest = strippedFiles.keys().next().value;
    if (oldest !== undefined) strippedFiles.delete(oldest);
  }
  return stripped;
}

/**
 * Drops the stripped files of a package, as its plugin's renderer closes
 * for good: an uninstall or an update leaves nothing behind. Matches the
 * package by the folder each file was served from, which holds even once
 * the folder is gone and its real path can't be read, and by its real path.
 *
 * @param {string} packageDirectory
 */
async function forgetStrippedFiles(packageDirectory) {
  const roots = [path.resolve(packageDirectory)];
  try {
    roots.push(await realpath(packageDirectory));
  } catch {
    // A package that is already gone has only its path as given.
  }
  for (const [key, entry] of [...strippedFiles]) {
    if (
      entry.packageDirectory === roots[0] ||
      roots.some((root) => isInside(key, root))
    ) {
      strippedFiles.delete(key);
    }
  }
}

/** How many stripped files are kept, for tests. */
function strippedFileCount() {
  return strippedFiles.size;
}

/**
 * Answers a request in the plugin's origin: Ajour's own files from
 * `hostDirectory`, the plugin's from its package, and 404 for anything
 * else, a file a link leads out of the package included. A `.ts` or `.mts`
 * file is served as JavaScript, with its types stripped. One that can't be
 * stripped answers 500, so no module of the graph that imports it runs,
 * and `onSourceRefused` hears which file and why.
 *
 * @param {{ url: string, method?: string }} request
 * @param {{
 *   pluginId: string,
 *   packageDirectory: string,
 *   hostDirectory: string,
 *   onSourceRefused?: (refusal: { file: string, reason: string }) => void,
 * }} served
 * @returns {Promise<Response>}
 */
async function servePluginFile(
  request,
  { pluginId, packageDirectory, hostDirectory, onSourceRefused },
) {
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: pluginFileHeaders("404.txt"),
    });
  if (request.method && request.method !== "GET") return notFound();
  const resolved = resolvePluginFile(request.url, pluginId, packageDirectory);
  try {
    if (resolved.kind === "host") {
      const body = await readFile(path.join(hostDirectory, resolved.file));
      return new Response(body, {
        headers: pluginFileHeaders(resolved.file, "host"),
      });
    }
    if (resolved.kind === "package") {
      const root = await realpath(packageDirectory);
      const real = await realpath(resolved.filePath);
      if (!isInside(real, root)) return notFound();
      const stats = await stat(real);
      if (!stats.isFile()) return notFound();
      if (TYPESCRIPT_EXTENSIONS.has(path.extname(real).toLowerCase())) {
        // The path as requested, which is the one the plugin's author wrote.
        const file = path
          .relative(path.resolve(packageDirectory), resolved.filePath)
          .split(path.sep)
          .join("/");
        const stripped = await strippedFile(
          real,
          stats.size,
          path.resolve(packageDirectory),
        );
        if (stripped.refused !== undefined) {
          onSourceRefused?.({ file, reason: `${file} ${stripped.refused}` });
          return new Response("This file can't run.", {
            status: 500,
            headers: pluginFileHeaders("500.txt"),
          });
        }
        return new Response(stripped.code, {
          headers: pluginFileHeaders(path.basename(real), "package"),
        });
      }
      const body = await readFile(real);
      return new Response(body, {
        headers: pluginFileHeaders(path.basename(real), "package"),
      });
    }
  } catch {
    // A file that is missing or can't be read is not found.
  }
  return notFound();
}

/**
 * The plugin an IPC call comes from, or undefined when it comes from
 * anything else. The sender's frame is read at once, before anything
 * awaits: it must be attached, a main frame with no parent, in a view Ajour
 * registered for a plugin, and on that plugin's origin. The plugin's
 * identity comes from the sender, never from what it sent.
 *
 * @param {{ sender?: { id?: number, mainFrame?: unknown } | null, senderFrame?: { detached?: boolean, parent?: unknown, origin?: string, processId?: number, routingId?: number } | null }} event
 * @param {(webContentsId: number) => string | undefined} registeredPluginOf
 * @returns {string | undefined}
 */
function pluginOfSender(event, registeredPluginOf) {
  try {
    const frame = event.senderFrame;
    const sender = event.sender;
    if (!frame || !sender || typeof sender.id !== "number") return undefined;
    if (frame.detached !== false || frame.parent !== null) return undefined;
    // The same frame can come as another object: it is compared by its ids.
    const main =
      /** @type {{ processId?: number, routingId?: number } | undefined} */ (
        sender.mainFrame
      );
    if (
      !main ||
      (main !== frame &&
        (typeof main.routingId !== "number" ||
          main.processId !== frame.processId ||
          main.routingId !== frame.routingId))
    ) {
      return undefined;
    }
    const pluginId = registeredPluginOf(sender.id);
    if (pluginId === undefined || frame.origin !== pluginOrigin(pluginId)) {
      return undefined;
    }
    return pluginId;
  } catch {
    // A frame that is gone can throw on access.
    return undefined;
  }
}

module.exports = {
  HOST_FILES,
  PLUGIN_CONTENT_SECURITY_POLICY,
  PLUGIN_SCHEME,
  hostPageUrl,
  forgetStrippedFiles,
  pluginFileHeaders,
  pluginOfSender,
  pluginOrigin,
  pluginPartition,
  pluginRequestAllowed,
  resolvePluginFile,
  servePluginFile,
  strippedFileCount,
};
