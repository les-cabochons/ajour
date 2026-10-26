// The real-Electron check of the broker's pinned requests (#434), which
// `scripts/check-plugin-sandbox.mjs` runs: the broker's transport
// (`electron/broker-transport.cjs`) on Electron's `net.request`, with its
// pinning tunnel. A stand-in service on loopback reads each TLS ClientHello
// and closes, so no request completes and none needs a certificate.
//
// - A pinned request to a name no DNS holds reaches the service: only the
//   tunnel's pin could have taken it there. Its ClientHello names the
//   name, so TLS and its certificate check stay on it.
// - A pinned request to a loopback literal goes through the tunnel too: the
//   pinned session bypasses its proxy for nothing.
// - A request on the pinned session with no live pin is refused by the
//   tunnel and connects nowhere: Chromium never falls back to a direct
//   connection.
//
// It reads one `CHECK {json}` line per finding on stdout.
"use strict";

const { app, net, session } = require("electron");
const { randomUUID } = require("node:crypto");
const nodeNet = require("node:net");
const path = require("node:path");

const electronRoot = path.resolve(__dirname, "../electron");
const { createBrokerNetwork, PINNED_PARTITION } = require(
  path.join(electronRoot, "broker-transport.cjs"),
);
const { createPinningTunnel } = require(
  path.join(electronRoot, "broker-pinning-tunnel.cjs"),
);

const userData = process.env.AJOUR_USER_DATA_PATH;
if (!userData) throw new Error("Set AJOUR_USER_DATA_PATH to a temp folder.");
app.setPath("userData", userData);

const NAME = "pinned.ajour-check.invalid";

function report(event, data = {}) {
  process.stdout.write(`CHECK ${JSON.stringify({ event, ...data })}\n`);
}

const watchdog = setTimeout(() => {
  report("watchdog");
  app.exit(9);
}, 60_000);

/** The server name a TLS ClientHello carries, or null. */
function serverName(hello) {
  try {
    // Record header (5), handshake header (4), version (2), random (32).
    let at = 5 + 4 + 2 + 32;
    at += 1 + hello[at]; // session id
    at += 2 + hello.readUInt16BE(at); // cipher suites
    at += 1 + hello[at]; // compression methods
    const end = at + 2 + hello.readUInt16BE(at);
    at += 2;
    while (at + 4 <= end) {
      const type = hello.readUInt16BE(at);
      const length = hello.readUInt16BE(at + 2);
      if (type === 0) {
        // Server name list (2), name type (1), name length (2), name.
        const nameLength = hello.readUInt16BE(at + 4 + 3);
        return hello.toString("ascii", at + 4 + 5, at + 4 + 5 + nameLength);
      }
      at += 4 + length;
    }
  } catch {
    // Not a ClientHello it can read.
  }
  return null;
}

/** A stand-in service: it reads one ClientHello per connection and closes. */
async function startService() {
  const hellos = [];
  const server = nodeNet.createServer((socket) => {
    socket.on("error", () => undefined);
    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 5) return;
      if (received.length < 5 + received.readUInt16BE(3)) return;
      hellos.push({ serverName: serverName(received) });
      socket.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, hellos, server };
}

/** What a send ended with, as text. */
function outcome(promise) {
  return promise.then(
    (response) => `status ${response.status}`,
    (error) => String(error?.message ?? error),
  );
}

app
  .whenReady()
  .then(async () => {
    const service = await startService();
    const dials = [];
    const tunnel = createPinningTunnel({
      connect: (options) => {
        dials.push(`${options.host}:${options.port}`);
        return nodeNet.connect(options);
      },
    });
    const network = createBrokerNetwork({ net, session, randomUUID, tunnel });
    const send = (url) =>
      outcome(
        network.transport.send({
          url,
          connectTo: ["127.0.0.1"],
          method: "GET",
          headers: { authorization: "Bearer fixture" },
          signal: AbortSignal.timeout(10_000),
          maxResponseBytes: 1024,
        }),
      );

    const named = await send(`https://${NAME}:${service.port}/feed.ics`);
    report("name", {
      outcome: named,
      dials: [...dials],
      hellos: [...service.hellos],
    });

    const literal = await send(`https://127.0.0.1:${service.port}/`);
    report("literal", {
      outcome: literal,
      dials: [...dials],
      hellos: [...service.hellos],
    });

    // The pinned session, with no live pin: nothing may connect.
    const before = { dials: dials.length, hellos: service.hellos.length };
    const unpinned = await new Promise((resolve) => {
      const request = net.request({
        url: `https://${NAME}:${service.port}/again`,
        session: session.fromPartition(PINNED_PARTITION, { cache: false }),
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
      });
      request.on("response", (response) =>
        resolve(`status ${response.statusCode}`),
      );
      request.on("error", (error) => resolve(String(error.message)));
      request.end();
    });
    report("unpinned", {
      outcome: unpinned,
      newDials: dials.length - before.dials,
      newHellos: service.hellos.length - before.hellos,
    });

    await network.close();
    service.server.close();
    report("quitting", {
      appPids: app.getAppMetrics().map((metric) => metric.pid),
    });
    clearTimeout(watchdog);
    app.quit();
  })
  .catch((error) => {
    report("error", { error: String(error?.stack ?? error) });
    app.exit(2);
  });
