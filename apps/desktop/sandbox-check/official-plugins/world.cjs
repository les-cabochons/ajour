// The release check's fixture network. Plugins reach it through the real
// credential broker, so every request goes the way a user's does: the
// manifest's endpoints and derived hosts, the access choices, the address
// policy, redirects and scrubbing. Only the last hop is replaced. A virtual
// host such as `api.github.com` is a handler here, and the transport sends
// the exchange over real HTTP to one loopback server that dispatches on the
// Host header. The resolver names every fixture host a public documentation
// address, and a few names private ones, so the broker's address rules run
// on real answers. Electron's own network stack and its pinning are
// covered by `sandbox-check/broker-pinning.cjs`.
"use strict";

const http = require("node:http");

/** A public address, as the API tests use for a public host. */
const PUBLIC_ADDRESS = "93.184.216.34";

function flatten(headers) {
  const flat = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    flat[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flat;
}

/**
 * @typedef {{
 *   method: string, host: string, path: string, query: URLSearchParams,
 *   headers: Record<string, string>, body: string,
 * }} FixtureRequest
 * @typedef {{
 *   status: number, headers?: Record<string, string>, json?: unknown, body?: string,
 * }} FixtureAnswer
 */

async function createWorld() {
  /** @type {Map<string, (request: FixtureRequest) => FixtureAnswer>} */
  const hosts = new Map();
  /** Names that resolve to an address the broker must refuse. */
  const privateNames = new Map();
  /** Every exchange a fixture host received, in order. */
  const received = [];

  const server = http.createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      const host = String(incoming.headers.host ?? "")
        .split(":")[0]
        .toLowerCase();
      const url = new URL(incoming.url, "http://fixture");
      const request = {
        method: incoming.method,
        host,
        path: url.pathname,
        query: url.searchParams,
        headers: flatten(incoming.headers),
        body: Buffer.concat(chunks).toString("utf8"),
      };
      received.push(request);
      const handler = hosts.get(host);
      const answer = handler
        ? handler(request)
        : { status: 502, body: `No fixture host ${host}` };
      const body =
        answer.json !== undefined
          ? JSON.stringify(answer.json)
          : (answer.body ?? "");
      outgoing.writeHead(answer.status, {
        ...(answer.json !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...answer.headers,
      });
      outgoing.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const transport = {
    send(request) {
      return new Promise((resolve, reject) => {
        const url = new URL(request.url);
        if (!hosts.has(url.hostname)) {
          reject(
            Object.assign(new Error(`${url.hostname} is not reachable.`), {
              code: "ENOTFOUND",
            }),
          );
          return;
        }
        const outgoing = http.request(
          {
            host: "127.0.0.1",
            port,
            method: request.method,
            path: `${url.pathname}${url.search}`,
            // The exchange keeps the name the broker built it for.
            headers: { ...request.headers, host: url.host },
            signal: request.signal,
          },
          (response) => {
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
              size += chunk.byteLength;
              if (size > request.maxResponseBytes) {
                response.destroy();
                reject(
                  Object.assign(new Error("The answer is too large."), {
                    code: "response_too_large",
                  }),
                );
                return;
              }
              chunks.push(chunk);
            });
            response.on("error", reject);
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: flatten(response.headers),
                body: new Uint8Array(Buffer.concat(chunks)),
                remoteAddress: PUBLIC_ADDRESS,
              }),
            );
          },
        );
        outgoing.on("error", reject);
        outgoing.end(request.body ? Buffer.from(request.body) : undefined);
      });
    },
  };

  const resolver = {
    async resolve(hostname) {
      const refused = privateNames.get(hostname);
      if (refused) return { addresses: [refused] };
      if (hosts.has(hostname)) return { addresses: [PUBLIC_ADDRESS] };
      throw Object.assign(new Error(`${hostname} did not resolve.`), {
        code: "ENOTFOUND",
      });
    },
  };

  return {
    transport,
    resolver,
    received,
    host: (name, handler) => hosts.set(name.toLowerCase(), handler),
    /** A name that resolves to a private address, such as `10.0.0.5`. */
    privateHost: (name, address) =>
      privateNames.set(name.toLowerCase(), address),
    /** What the hosts received since `mark`, optionally of one host. */
    since: (mark, host) =>
      received.slice(mark).filter((r) => host === undefined || r.host === host),
    mark: () => received.length,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

module.exports = { createWorld, PUBLIC_ADDRESS };
