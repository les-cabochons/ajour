import { createRequire } from "node:module";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createPinningTunnel } =
  require("./electron/broker-pinning-tunnel.cjs") as {
    createPinningTunnel: (options?: {
      connect?: typeof net.connect;
      maxConnections?: number;
      connectTimeoutMs?: number;
    }) => PinningTunnel;
  };

interface PinningTunnel {
  listen(): Promise<number>;
  pin(host: string, port: number, addresses: readonly string[]): () => void;
  close(): Promise<void>;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** A service on this computer that echoes, and counts who connected. */
async function echoService() {
  const peers: string[] = [];
  const server = net.createServer((socket) => {
    peers.push(socket.remoteAddress ?? "");
    socket.on("error", () => undefined);
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return { port: (server.address() as net.AddressInfo).port, peers };
}

async function startTunnel(
  options: Parameters<typeof createPinningTunnel>[0] = {},
) {
  const tunnel = createPinningTunnel(options);
  const port = await tunnel.listen();
  closers.push(() => tunnel.close());
  return { tunnel, port };
}

/** Sends `head` to the tunnel as Chromium would, and reads what comes back. */
function talk(port: number, head: string, then?: string) {
  return new Promise<{ received: string; closed: boolean }>((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    let received = "";
    let wrote = false;
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
      if (!wrote && received.includes("\r\n\r\n")) {
        wrote = true;
        if (then === undefined) socket.end();
        else socket.write(then);
      }
      if (then !== undefined && received.endsWith(then)) {
        socket.end();
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => resolve({ received, closed: true }));
    socket.write(head);
  });
}

const connectHead = (target: string) =>
  `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Connection: keep-alive\r\n\r\n`;

describe("the broker's pinning tunnel", () => {
  it("connects a pinned host only to its pinned address, whatever the name resolves to", async () => {
    const service = await echoService();
    const { tunnel, port } = await startTunnel();
    // The name doesn't resolve at all: the tunnel never asks DNS.
    tunnel.pin("feeds.ajour-check.invalid", service.port, ["127.0.0.1"]);

    const { received } = await talk(
      port,
      connectHead(`feeds.ajour-check.invalid:${service.port}`),
      "hello through the pin",
    );

    expect(received).toMatch(/^HTTP\/1\.1 200 /);
    expect(received.endsWith("hello through the pin")).toBe(true);
    expect(service.peers).toEqual(["127.0.0.1"]);
  });

  it("refuses a host with no live pin, and connects nowhere", async () => {
    const service = await echoService();
    const { tunnel, port } = await startTunnel();
    const unpin = tunnel.pin("feeds.ajour-check.invalid", service.port, [
      "127.0.0.1",
    ]);

    const other = await talk(
      port,
      connectHead(`other.ajour-check.invalid:${service.port}`),
    );
    const otherPort = await talk(
      port,
      connectHead(`feeds.ajour-check.invalid:${service.port + 1}`),
    );
    unpin();
    const afterUnpin = await talk(
      port,
      connectHead(`feeds.ajour-check.invalid:${service.port}`),
    );

    for (const answer of [other, otherPort, afterUnpin]) {
      expect(answer.received).toMatch(/^HTTP\/1\.1 403 /);
    }
    expect(service.peers).toEqual([]);
  });

  it("matches the host in any case and an IPv6 literal without its brackets", async () => {
    const service = await echoService();
    const { tunnel, port } = await startTunnel();
    tunnel.pin("feeds.ajour-check.invalid", service.port, ["127.0.0.1"]);
    tunnel.pin("::1", service.port, ["127.0.0.1"]);

    const named = await talk(
      port,
      connectHead(`Feeds.AJOUR-check.invalid:${service.port}`),
    );
    const literal = await talk(port, connectHead(`[::1]:${service.port}`));

    expect(named.received).toMatch(/^HTTP\/1\.1 200 /);
    expect(literal.received).toMatch(/^HTTP\/1\.1 200 /);
  });

  it("tries the pinned addresses in order, and fails when none connects", async () => {
    const service = await echoService();
    const tried: string[] = [];
    const connect = ((options: net.NetConnectOpts & { host: string }) => {
      tried.push(options.host);
      if (options.host === "192.0.2.10") {
        const socket = new net.Socket();
        process.nextTick(() =>
          socket.emit("error", new Error("connect ECONNREFUSED")),
        );
        return socket;
      }
      return net.connect(options);
    }) as typeof net.connect;
    const { tunnel, port } = await startTunnel({ connect });
    tunnel.pin("feeds.ajour-check.invalid", service.port, [
      "192.0.2.10",
      "127.0.0.1",
    ]);
    tunnel.pin("down.ajour-check.invalid", service.port, ["192.0.2.10"]);

    const fallback = await talk(
      port,
      connectHead(`feeds.ajour-check.invalid:${service.port}`),
    );
    const down = await talk(
      port,
      connectHead(`down.ajour-check.invalid:${service.port}`),
    );

    expect(fallback.received).toMatch(/^HTTP\/1\.1 200 /);
    expect(down.received).toMatch(/^HTTP\/1\.1 502 /);
    expect(tried).toEqual(["192.0.2.10", "127.0.0.1", "192.0.2.10"]);
  });

  it("refuses to pin anything but an IP address, so the tunnel never resolves a name", async () => {
    const tunnel = createPinningTunnel();

    for (const address of [
      "internal.example.net",
      "127.0.0.1.nip.io",
      "localhost",
      "",
      "1.2.3",
    ]) {
      expect(() =>
        tunnel.pin("feeds.ajour-check.invalid", 443, [address]),
      ).toThrow(/IP address/);
    }
    // Nothing of a refused pin stays live, even next to an address that is one.
    expect(() =>
      tunnel.pin("feeds.ajour-check.invalid", 443, ["192.0.2.10", "localhost"]),
    ).toThrow(/IP address/);
    expect(() =>
      tunnel.pin("feeds.ajour-check.invalid", 443, [
        "192.0.2.10",
        "2001:db8::1",
      ]),
    ).not.toThrow();
    await tunnel.close();
  });

  it("moves on to the next address when one doesn't answer in time", async () => {
    const service = await echoService();
    const tried: string[] = [];
    const connect = ((options: net.NetConnectOpts & { host: string }) => {
      tried.push(options.host);
      // Never answers: neither connects nor fails.
      if (options.host === "192.0.2.10") return new net.Socket();
      return net.connect(options);
    }) as typeof net.connect;
    const { tunnel, port } = await startTunnel({
      connect,
      connectTimeoutMs: 50,
    });
    tunnel.pin("feeds.ajour-check.invalid", service.port, [
      "192.0.2.10",
      "127.0.0.1",
    ]);
    tunnel.pin("down.ajour-check.invalid", service.port, ["192.0.2.10"]);

    const fallback = await talk(
      port,
      connectHead(`feeds.ajour-check.invalid:${service.port}`),
    );
    const down = await talk(
      port,
      connectHead(`down.ajour-check.invalid:${service.port}`),
    );

    expect(fallback.received).toMatch(/^HTTP\/1\.1 200 /);
    expect(down.received).toMatch(/^HTTP\/1\.1 502 /);
  });

  it("holds only so many connections at once, and drops the rest", async () => {
    const service = await echoService();
    const { tunnel, port } = await startTunnel({ maxConnections: 2 });
    tunnel.pin("feeds.ajour-check.invalid", service.port, ["127.0.0.1"]);
    const target = `feeds.ajour-check.invalid:${service.port}`;

    const open = () =>
      new Promise<net.Socket>((resolve) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.on("error", () => undefined);
        socket.once("data", () => resolve(socket));
        socket.write(connectHead(target));
      });
    const first = await open();
    const second = await open();
    const third = net.connect(port, "127.0.0.1");
    third.on("error", () => undefined);
    const dropped = new Promise<string>((resolve) => {
      let received = "";
      third.on("data", (chunk) => (received += chunk.toString("latin1")));
      third.on("close", () => resolve(received));
    });
    third.write(connectHead(target));

    expect(await dropped).toBe("");
    first.destroy();
    second.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = await open();
    again.destroy();
  });

  it("answers a request that isn't a CONNECT with nothing, so no answer of its own reaches a plugin", async () => {
    const service = await echoService();
    const { tunnel, port } = await startTunnel();
    tunnel.pin("feeds.ajour-check.invalid", service.port, ["127.0.0.1"]);

    const { received, closed } = await talk(
      port,
      `GET http://feeds.ajour-check.invalid:${service.port}/ HTTP/1.1\r\nHost: feeds.ajour-check.invalid\r\n\r\n`,
    );

    expect(received).toBe("");
    expect(closed).toBe(true);
    expect(service.peers).toEqual([]);
  });

  it("listens on this computer's loopback only, and ends its tunnels when closed", async () => {
    const service = await echoService();
    const tunnel = createPinningTunnel();
    const port = await tunnel.listen();
    tunnel.pin("feeds.ajour-check.invalid", service.port, ["127.0.0.1"]);

    const socket = net.connect(port, "127.0.0.1");
    const closed = new Promise<void>((resolve) => socket.on("close", resolve));
    socket.on("error", () => undefined);
    socket.write(connectHead(`feeds.ajour-check.invalid:${service.port}`));
    await new Promise((resolve) => socket.once("data", resolve));
    expect(socket.remoteAddress).toBe("127.0.0.1");

    await tunnel.close();
    await closed;
  });
});
