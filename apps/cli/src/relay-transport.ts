import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { Duplex, Readable } from "node:stream";
import { UnreachableError } from "./errors.ts";

export const RELAY_START_FAILED =
  "ajour can't start ajour.exe to reach Ajour on Windows. Check that WSL can run Windows programs.";

export interface RelayTransport {
  fetch: typeof globalThis.fetch;
  close(): void;
}

/** Each HTTP connection owns one relay; destroying it also ends the child. */
export function createRelayFetch(
  executable: string,
  args = ["__relay"],
): RelayTransport {
  const agent = new http.Agent({ keepAlive: true });
  // These are pipes, not TCP sockets. The relay owns TCP keep-alive.
  agent.keepSocketAlive = () => true;
  agent.reuseSocket = () => undefined;
  agent.createConnection = (options) => {
    const child = spawn(executable, [...args, String(options.port)], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const socket = new Duplex({
      read() {
        child.stdout.resume();
      },
      write(chunk, encoding, callback) {
        child.stdin.write(chunk, encoding, callback);
      },
      final(callback) {
        child.stdin.end(callback);
      },
      destroy(error, callback) {
        child.stdout.destroy();
        child.stdin.destroy();
        child.kill();
        callback(error);
      },
    });
    child.stdout.on("data", (chunk) => {
      if (!socket.push(chunk)) child.stdout.pause();
    });
    child.stdout.on("end", () => socket.push(null));
    child.stdout.on("error", (error) => socket.destroy(error));
    child.stdin.on("error", (error) => socket.destroy(error));
    child.on("error", () =>
      socket.destroy(new UnreachableError(RELAY_START_FAILED)),
    );
    child.on("exit", (code) => {
      if (code)
        socket.destroy(
          Object.assign(new Error("Relay connection failed"), {
            code: "ECONNREFUSED",
          }),
        );
    });
    return socket;
  };
  return {
    close: () => agent.destroy(),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(url.hostname)
      ) {
        throw new UnreachableError(
          "The Windows relay requires an HTTP loopback URL.",
        );
      }
      const body = request.body
        ? Buffer.from(await request.arrayBuffer())
        : undefined;
      return new Promise<Response>((resolve, reject) => {
        const headers = Object.fromEntries(request.headers);
        const req = http.request(
          url,
          { method: request.method, headers, agent, signal: request.signal },
          (res) => {
            const responseHeaders = new Headers();
            for (let i = 0; i < res.rawHeaders.length; i += 2)
              responseHeaders.append(
                res.rawHeaders[i]!,
                res.rawHeaders[i + 1]!,
              );
            const status = res.statusCode ?? 500;
            const noBody =
              request.method === "HEAD" || [204, 205, 304].includes(status);
            resolve(
              new Response(
                noBody
                  ? null
                  : (Readable.toWeb(res) as ReadableStream<Uint8Array>),
                { status, headers: responseHeaders },
              ),
            );
            if (noBody) res.resume();
          },
        );
        req.on("error", reject);
        req.end(body);
      });
    },
  };
}

export async function transportFor(
  url: string,
  probes: RelayProbes,
): Promise<RelayTransport | undefined> {
  const executable = await relayExecutable(url, probes);
  return executable ? createRelayFetch(executable) : undefined;
}

export interface RelayProbes {
  env: Readonly<Record<string, string | undefined>>;
  executable(): Promise<string>;
  exists(file: string): Promise<boolean>;
}

export const processRelayProbes: RelayProbes = {
  env: process.env,
  executable: () => realpath(process.execPath),
  exists: async (file) => existsSync(file),
};

export async function relayExecutable(
  url: string,
  probes: RelayProbes,
): Promise<string | undefined> {
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) return;
  if (
    !probes.env.WSL_DISTRO_NAME &&
    !(await probes.exists("/proc/sys/fs/binfmt_misc/WSLInterop"))
  )
    return;
  const executable = path.posix.join(
    path.posix.dirname(await probes.executable()),
    "..",
    "ajour.exe",
  );
  return (await probes.exists(executable)) ? executable : undefined;
}
