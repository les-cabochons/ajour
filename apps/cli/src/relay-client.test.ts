import { afterEach, expect, it } from "vitest";
import { run } from "./main.ts";
import { ajour, closeTerminals } from "./test-support/terminal.ts";
import { createRelayFetch } from "./relay-transport.ts";
import { mcpClient, NOT_RUNNING } from "./client.ts";
import { createServer } from "node:net";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { RELAY_START_FAILED } from "./relay-transport.ts";

afterEach(closeTerminals);

it("Given the SDK opens SSE GET, closing the client aborts the relayed stream", async () => {
  const term = await ajour({});
  let opened!: () => void;
  let closed!: () => void;
  const listening = new Promise<void>((resolve) => (opened = resolve));
  const ended = new Promise<void>((resolve) => (closed = resolve));
  const server = httpServer(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": ready\n\n");
      res.once("close", closed);
      opened();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (
        value &&
        !["host", "connection", "transfer-encoding", "content-length"].includes(
          key,
        )
      )
        headers.set(key, String(value));
    }
    const response = await fetch(`${term.io.env.AJOUR_URL}/mcp/ajour`, {
      method: req.method,
      headers,
      body: Buffer.concat(chunks),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const relay = createRelayFetch(process.execPath, [
    "--no-warnings",
    "src/main.ts",
    "__relay",
  ]);
  const client = mcpClient({
    url: `http://127.0.0.1:${address.port}`,
    token: term.io.env.AJOUR_TOKEN!,
    fetch: relay.fetch,
  });
  try {
    await client.check();
    await listening;
    await client.close();
    await ended;
  } finally {
    relay.close();
    server.closeAllConnections();
    server.close();
  }
});

it("Given a refused relay connection, the command says Ajour is not running", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const term = await ajour({});
  term.io.env = {
    ...term.io.env,
    AJOUR_URL: `http://127.0.0.1:${address.port}`,
  };
  term.io.transport = async () =>
    createRelayFetch(process.execPath, [
      "--no-warnings",
      "src/main.ts",
      "__relay",
    ]);
  expect(await run(["status"], term.io)).toBe(3);
  expect(term.err()).toContain(NOT_RUNNING);
});

it("Given a relay that cannot spawn, the command exits 3 with the interop advice", async () => {
  const term = await ajour({});
  term.io.transport = async () => createRelayFetch("/missing/ajour.exe");
  expect(await run(["status"], term.io)).toBe(3);
  expect(term.err()).toContain(RELAY_START_FAILED);
});

it("Given a stdio relay, status and connect reach the real API", async () => {
  const term = await ajour({
    list_time_entries: () => ({ entries: [], running: null }),
    get_running_timer: () => ({ running: null }),
    get_last_saved_entry: () => ({ entry: null }),
  });
  const relay = createRelayFetch(process.execPath, [
    "--no-warnings",
    "src/main.ts",
    "__relay",
  ]);
  term.io.transport = async () => relay;
  try {
    expect(await run(["status"], term.io)).toBe(0);
    expect(term.out()).toContain("Nothing running");
    term.io.readStdin = async () => term.io.env.AJOUR_TOKEN!;
    expect(await run(["connect", "--token-stdin"], term.io)).toBe(0);
    expect(term.err()).toContain("Connected to Ajour");
    const client = mcpClient({
      url: term.io.env.AJOUR_URL!,
      token: term.io.env.AJOUR_TOKEN!,
      fetch: relay.fetch,
    });
    try {
      await client.check();
    } finally {
      await client.close();
    }
  } finally {
    relay.close();
  }
});
