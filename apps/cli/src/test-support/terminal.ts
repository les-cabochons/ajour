import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  BridgeToolCall,
  BridgeToolResult,
} from "../../../../packages/shared/agent-tools.ts";
import {
  enableMcpWithClient,
  openFakeWindow,
  startTestApi,
} from "../../../api/src/test-support/mcp-harness.ts";
import type { CliIo } from "../io.ts";

/**
 * A connected terminal for the CLI's integration tests: the real local API,
 * the CLI's own client token, and a fake Ajour window that answers each
 * tool from the test's handlers.
 */

// Wednesday 4 November 2026, 14:44:07 local time.
export const NOW = new Date(2026, 10, 4, 14, 44, 7).getTime();
export const TODAY = "2026-11-04";

const cleanups: (() => Promise<void>)[] = [];

/** Stops every API and window the test opened. Call it in afterEach. */
export async function closeTerminals(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

/** 32 hex characters starting with `start`, as an entry's short id. */
export function hexId(start: string): string {
  return start.padEnd(32, "0");
}

export const projects = {
  projects: [
    {
      projectId: "p-acme",
      name: "Acme Platform",
      code: "ACME",
      tasks: [
        { taskId: "t-meet", name: "03 Meetings", pinnedSlot: 1 },
        { taskId: "t-backend", name: "05 Backend" },
        { taskId: "t-code-review", name: "08 Code review" },
      ],
    },
    {
      projectId: "p-ajr",
      name: "Ajour Desktop",
      code: "AJR",
      tasks: [
        { taskId: "t-review", name: "04 Review" },
        { taskId: "t-export", name: "07 Export" },
      ],
    },
  ],
};

export type Answer = object | { refuse: string };
/** Each handler types the input it reads, as the tool's schema says. */
export type Handlers = Partial<Record<string, (input: never) => Answer>>;

/** A fake Ajour window that answers each tool from the test's handlers. */
function scripted(handlers: Handlers) {
  return (call: BridgeToolCall): BridgeToolResult => {
    const handler = handlers[call.tool];
    if (!handler) {
      return {
        requestId: call.requestId,
        ok: false,
        error: `No fixture for ${call.tool}.`,
      };
    }
    const answer = handler(call.input as never);
    return "refuse" in answer
      ? { requestId: call.requestId, ok: false, error: answer.refuse }
      : { requestId: call.requestId, ok: true, output: answer };
  };
}

export interface Terminal {
  io: CliIo;
  out(): string;
  err(): string;
  /** Clears what was printed, between commands. */
  clear(): void;
  calls: BridgeToolCall[];
  home: string;
}

/** A connected terminal against the real local API and a scripted window. */
export async function ajour(handlers: Handlers): Promise<Terminal> {
  const api = await startTestApi();
  cleanups.push(() => api.stop());
  const { token } = await enableMcpWithClient(api);
  const fake = await openFakeWindow(api, scripted(handlers));
  cleanups.push(() => fake.close());
  const home = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-terminal-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  let out = "";
  let err = "";
  return {
    home,
    calls: fake.calls,
    out: () => out,
    err: () => err,
    clear: () => {
      out = "";
      err = "";
    },
    io: {
      stdout: {
        write: (text) => void (out += text),
        isTTY: false,
        columns: 120,
      },
      stderr: { write: (text) => void (err += text), isTTY: false },
      env: {
        AJOUR_URL: api.baseUrl,
        AJOUR_TOKEN: token,
        XDG_CONFIG_HOME: path.join(home, "config"),
        XDG_STATE_HOME: path.join(home, "state"),
      },
      platform: process.platform,
      homedir: home,
      now: () => NOW,
      readSecret: async () => "",
      readStdin: async () => "",
      wait: async () => false,
      releaseInput: () => undefined,
    },
  };
}

/** The write tools the CLI called, with their inputs. */
export function writes(term: Terminal) {
  return term.calls
    .filter((call) => !/^(list_|get_|find_)/.test(call.tool))
    .map((call) => ({ tool: call.tool, input: call.input }));
}

/** Where the CLI keeps the last change's Undo token. */
export function undoFile(term: Terminal): string {
  return path.join(term.home, "state", "ajour", "last-undo");
}
