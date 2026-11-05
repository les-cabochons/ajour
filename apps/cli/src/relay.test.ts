import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { expect, it } from "vitest";
import { relayExecutable } from "./relay-transport.ts";

it("Given a closed TCP port, __relay exits nonzero with stderr only", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const child = spawn(process.execPath, [
    "--no-warnings",
    "src/main.ts",
    "__relay",
    String(address.port),
  ]);
  let out = "";
  let err = "";
  child.stdout.on("data", (bytes) => (out += bytes));
  child.stderr.on("data", (bytes) => (err += bytes));
  expect((await once(child, "close"))[0]).toBe(1);
  expect(out).toBe("");
  expect(err).toContain("Relay connection failed");
});

it.each(["0", "65536", "-1", "1.5", "abc", "1e3", ""])(
  "Given invalid port %s, __relay exits 2 without stdout",
  async (port) => {
    const child = spawn(process.execPath, [
      "--no-warnings",
      "src/main.ts",
      "__relay",
      port,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (bytes) => (out += bytes));
    child.stderr.on("data", (bytes) => (err += bytes));
    expect((await once(child, "close"))[0]).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("Invalid relay port");
  },
);

it("Given stdin closes, __relay exits and closes the TCP connection", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const accepted = once(server, "connection");
  const child = spawn(process.execPath, [
    "--no-warnings",
    "src/main.ts",
    "__relay",
    String(address.port),
  ]);
  try {
    const [socket] = await accepted;
    const closed = once(socket, "close");
    socket.resume();
    child.stdin.end();
    expect((await once(child, "close"))[0]).toBe(0);
    await closed;
  } finally {
    child.kill();
    server.close();
  }
});

it("Given WSL and an installed sibling, only loopback URLs use the relay", async () => {
  const probes = {
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    executable: async () => "/opt/ajour/bin/linux/ajour",
    exists: async (file: string) => file === "/opt/ajour/bin/ajour.exe",
  };
  expect(await relayExecutable("http://localhost:8787", probes)).toBe(
    "/opt/ajour/bin/ajour.exe",
  );
  expect(await relayExecutable("http://example.com", probes)).toBeUndefined();
  expect(
    await relayExecutable("http://127.0.0.1", { ...probes, env: {} }),
  ).toBeUndefined();
  expect(
    await relayExecutable("http://127.0.0.1", {
      ...probes,
      exists: async () => false,
    }),
  ).toBeUndefined();
  expect(
    await relayExecutable("http://127.0.0.1", {
      ...probes,
      env: {},
      exists: async () => true,
    }),
  ).toBe("/opt/ajour/bin/ajour.exe");
});

it("Given a TCP server, __relay round-trips bytes and exits when the server closes", async () => {
  const server = createServer((socket) => {
    socket.once("data", (bytes) => socket.end(bytes));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const child = spawn(process.execPath, [
    "--no-warnings",
    "src/main.ts",
    "__relay",
    String(address.port),
  ]);
  let out = "";
  let err = "";
  child.stdout.on("data", (bytes) => (out += bytes));
  child.stderr.on("data", (bytes) => (err += bytes));
  try {
    child.stdin.write("hello\0relay\n");
    expect((await once(child, "close"))[0]).toBe(0);
    expect(out).toBe("hello\0relay\n");
    expect(err).toBe("");
  } finally {
    child.kill();
    server.close();
  }
});
