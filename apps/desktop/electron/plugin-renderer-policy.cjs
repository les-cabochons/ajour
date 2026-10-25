// @ts-check
const path = require("node:path");
const { readFile, realpath, stat } = require("node:fs/promises");

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

/** The types a plugin's files are served as. Anything else is opaque bytes. */
const CONTENT_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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

/**
 * Answers a request in the plugin's origin: Ajour's own files from
 * `hostDirectory`, the plugin's from its package, and 404 for anything
 * else, a file a link leads out of the package included.
 *
 * @param {{ url: string, method?: string }} request
 * @param {{ pluginId: string, packageDirectory: string, hostDirectory: string }} served
 * @returns {Promise<Response>}
 */
async function servePluginFile(
  request,
  { pluginId, packageDirectory, hostDirectory },
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
      if (!isInside(real, root) || !(await stat(real)).isFile()) {
        return notFound();
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
  pluginFileHeaders,
  pluginOfSender,
  pluginOrigin,
  pluginPartition,
  pluginRequestAllowed,
  resolvePluginFile,
  servePluginFile,
};
