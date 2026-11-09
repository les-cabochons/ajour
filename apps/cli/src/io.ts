import os from "node:os";
import {
  processRelayProbes,
  transportFor,
  type RelayTransport,
} from "./relay-transport.ts";

/**
 * What a command may touch outside itself. `processIo` is the real process;
 * tests pass their own, so commands run in-process with a fixed clock, a
 * chosen terminal and captured output.
 */
export interface CliIo {
  transport?(url: string): Promise<RelayTransport | undefined>;
  stdout: OutputStream;
  stderr: OutputStream;
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  homedir: string;
  now(): number;
  /**
   * How long a live completion's lookup may run before the shell gets
   * nothing, in milliseconds. A terminal takes the default, 900. A test host
   * under load needs more: the child is a fresh Node process.
   */
  completionTimeoutMs?: number;
  /** Reads a line without echoing it, for a token. */
  readSecret(prompt: string): Promise<string>;
  /** Reads all of standard input. */
  readStdin(): Promise<string>;
  /** Waits, for `status --watch`. Resolves false once the user quits. */
  wait(ms: number): Promise<boolean>;
  /** Gives the terminal back after `wait`: raw mode off, input paused. */
  releaseInput(): void;
}

export interface OutputStream {
  write(text: string): void;
  isTTY: boolean;
  /** The terminal's width, when it is one. */
  columns?: number;
}

export function processIo(): CliIo {
  let quit = false;
  let release: (() => void) | undefined;
  return {
    transport: (url) => transportFor(url, processRelayProbes),
    stdout: {
      write: (text) => void process.stdout.write(text),
      isTTY: process.stdout.isTTY === true,
      get columns() {
        return process.stdout.columns;
      },
    },
    stderr: {
      write: (text) => void process.stderr.write(text),
      isTTY: process.stderr.isTTY === true,
    },
    env: process.env,
    platform: process.platform,
    homedir: os.homedir(),
    now: () => Date.now(),
    readSecret,
    readStdin,
    async wait(ms) {
      if (quit) return false;
      release ??= listenForQuit(() => (quit = true));
      await new Promise((resolve) => setTimeout(resolve, ms));
      return !quit;
    },
    releaseInput() {
      release?.();
      release = undefined;
    },
  };
}

/**
 * q or Ctrl-C on a terminal, or SIGINT anywhere, ends `--watch`. Returns
 * what undoes it, which `status` calls however the watch ends.
 */
function listenForQuit(onQuit: () => void): () => void {
  const onSignal = () => onQuit();
  process.once("SIGINT", onSignal);
  const input = process.stdin;
  const onData = (chunk: Buffer) => {
    const key = chunk.toString("utf8");
    if (key === "q" || key === "\u0003") onQuit();
  };
  if (input.isTTY) {
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  }
  return () => {
    process.off("SIGINT", onSignal);
    if (!input.isTTY) return;
    input.off("data", onData);
    input.setRawMode(false);
    input.pause();
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a line with each typed character shown as "•". */
function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stderr;
  output.write(prompt);
  if (!input.isTTY) {
    return readStdin().then((text) => text.split(/\r?\n/)[0] ?? "");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    input.setRawMode(true);
    input.resume();
    const onData = (chunk: Buffer) => {
      for (const key of chunk.toString("utf8")) {
        if (key === "\r" || key === "\n") {
          finish();
          output.write("\n");
          resolve(value);
          return;
        }
        if (key === "\u0003") {
          finish();
          output.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (key === "\u007f" || key === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }
        value += key;
        output.write("•");
      }
    };
    const finish = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
    };
    input.on("data", onData);
  });
}
