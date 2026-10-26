/**
 * The tunnel that pins the credential broker's requests to the addresses
 * it checked (#434). Electron's `net.request` resolves a name itself and
 * offers no way to say which address to connect to, so the broker's pinned
 * session (`broker-transport.cjs`) sends every request through this HTTP
 * CONNECT proxy on this computer's loopback. For each CONNECT the tunnel
 * opens a TCP connection to an address the broker pinned for that host and
 * port, and to no other: it never resolves a name. TLS runs inside the
 * tunnel, between Chromium and the service, so the Host header, the server
 * name and the certificate check stay on the name, as without it.
 *
 * - A CONNECT to a host and port with no live pin is refused with 403 and
 *   connects nowhere, so another program on this computer can only reach,
 *   through it, a public address the broker is reaching at that moment.
 * - Anything but a CONNECT is closed without an answer, so the tunnel never
 *   answers for a service.
 * - The pinned addresses are tried in order; when none connects, 502.
 * - Only IP addresses are pinned: `net.connect` would resolve any other
 *   string as a name, which the tunnel never does.
 * - At most `maxConnections` connections at once, and an address that
 *   doesn't answer within `connectTimeoutMs` is given up for the next one.
 * - Chromium may keep a tunnel open and send a later request to the same
 *   host and port through it. That tunnel still ends at an address the
 *   broker checked.
 */

const http = require("node:http");
const net = require("node:net");

/** Connections the tunnel holds at once; Chromium opens a few per host. */
const MAX_CONNECTIONS = 64;
/** How long one pinned address has to connect before the next is tried. */
const CONNECT_TIMEOUT_MS = 10_000;

/** A CONNECT target, `host:port` or `[v6]:port`, as a pin's key. */
function targetKey(host, port) {
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return `${bare.toLowerCase()}|${Number(port)}`;
}

/** The host and port of a CONNECT's request target, or undefined. */
function parseTarget(target) {
  const match = /^(\[[^\]]+\]|[^:[\]]+):(\d{1,5})$/.exec(String(target));
  if (!match) return undefined;
  const port = Number(match[2]);
  if (port < 1 || port > 65_535) return undefined;
  return { host: match[1], port };
}

/**
 * @param {{
 *   connect?: typeof net.connect,
 *   maxConnections?: number,
 *   connectTimeoutMs?: number,
 * }} [options]
 */
function createPinningTunnel({
  connect = net.connect,
  maxConnections = MAX_CONNECTIONS,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
} = {}) {
  /** Each live pin's addresses, by target, then by pin. */
  const pins = new Map();
  const sockets = new Set();
  const server = http.createServer();
  // Past it, a connection is closed without an answer.
  server.maxConnections = maxConnections;
  /** @type {Promise<number> | undefined} */
  let listening;

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  // Not a CONNECT: closed without an answer.
  server.on("request", (request) => request.socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());

  server.on("connect", (request, client, head) => {
    client.on("error", () => client.destroy());
    const target = parseTarget(request.url);
    const pinned = target
      ? pins.get(targetKey(target.host, target.port))
      : undefined;
    const addresses = pinned ? [...new Set([...pinned.values()].flat())] : [];
    if (!target || addresses.length === 0) {
      client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    let upstream;
    const tryAddress = (index) => {
      if (client.destroyed) return;
      if (index >= addresses.length) {
        client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      const address = addresses[index];
      let connected = false;
      let gaveUp = false;
      const socket = connect({
        host: address,
        port: target.port,
        family: net.isIP(address) === 6 ? 6 : 4,
      });
      upstream = socket;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      const giveUp = () => {
        if (connected || gaveUp) return;
        gaveUp = true;
        clearTimeout(timer);
        socket.destroy();
        tryAddress(index + 1);
      };
      const timer = setTimeout(giveUp, connectTimeoutMs);
      socket.once("connect", () => {
        if (gaveUp) return;
        clearTimeout(timer);
        connected = true;
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) socket.write(head);
        socket.pipe(client);
        client.pipe(socket);
      });
      socket.on("error", () => {
        if (connected) client.destroy();
        else giveUp();
      });
      socket.on("close", () => {
        clearTimeout(timer);
        if (connected) client.destroy();
      });
    };
    client.on("close", () => upstream?.destroy());
    tryAddress(0);
  });

  return {
    /** Starts listening on loopback, once, and answers its port. */
    listen() {
      listening ??= new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve(
            /** @type {import("node:net").AddressInfo} */ (server.address())
              .port,
          );
        });
      });
      return listening;
    },
    /**
     * Lets a CONNECT to `host` and `port` reach `addresses`, the ones the
     * broker checked, until the returned function is called.
     *
     * @param {string} host
     * @param {number} port
     * @param {readonly string[]} addresses
     */
    pin(host, port, addresses) {
      // `net.connect` resolves any other string as a name.
      for (const address of addresses) {
        if (net.isIP(address) === 0) {
          throw new Error("A pin holds IP addresses only.");
        }
      }
      const key = targetKey(host, port);
      const token = Symbol(key);
      let entry = pins.get(key);
      if (!entry) {
        entry = new Map();
        pins.set(key, entry);
      }
      entry.set(token, [...addresses]);
      return () => {
        const current = pins.get(key);
        if (!current) return;
        current.delete(token);
        if (current.size === 0) pins.delete(key);
      };
    },
    /** Stops listening and ends every tunnel. */
    close() {
      pins.clear();
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}

module.exports = { createPinningTunnel };
