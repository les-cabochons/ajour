import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { mcpClient, VERSION_MISMATCH } from "./client.ts";
import { createContext } from "./context.ts";
import { status } from "./commands/status.ts";
import { UnreachableError } from "./errors.ts";
import type { CliIo } from "./io.ts";

// Wednesday 4 November 2026, 14:44:07 local time.
const NOW = new Date(2026, 10, 4, 14, 44, 7).getTime();

/** An Ajour that answers some tools and fails the others as `failures` say. */
function ajourWith(failures: Record<string, () => Error>) {
  const answers: Record<string, unknown> = {
    list_time_entries: { entries: [], running: null },
    get_running_timer: { running: null },
    get_last_saved_entry: { entry: null },
  };
  let out = "";
  const io: CliIo = {
    stdout: { write: (text) => void (out += text), isTTY: false, columns: 100 },
    stderr: { write: () => undefined, isTTY: false },
    env: { NO_COLOR: "1" },
    platform: process.platform,
    homedir: "",
    now: () => NOW,
    readSecret: async () => "",
    readStdin: async () => "",
    wait: async () => false,
    releaseInput: () => undefined,
  };
  const ctx = createContext(io, { color: "never", json: false, quiet: false });
  const client = mcpClient({
    url: "http://127.0.0.1:9",
    token: "ajour_t",
    open: async () => ({
      callTool: async ({ name }) => {
        const fail = failures[name];
        if (fail) throw fail();
        return { structuredContent: answers[name] };
      },
      close: async () => undefined,
    }),
  });
  ctx.client = async () => client;
  return { ctx, out: () => out };
}

const toolNotFound = () =>
  new McpError(ErrorCode.InvalidParams, "Tool get_last_saved_entry not found");

describe("ajour status against an older Ajour", () => {
  it("prints the rest when only get_last_saved_entry is missing", async () => {
    const { ctx, out } = ajourWith({ get_last_saved_entry: toolNotFound });

    const code = await status(ctx, { short: false, idle: "", watch: false });

    expect(code).toBe(0);
    expect(out()).toBe("○ Nothing running · today 0:00\n");
  });

  it("still fails when a required read is missing", async () => {
    const { ctx } = ajourWith({
      list_time_entries: () =>
        new McpError(
          ErrorCode.InvalidParams,
          "Tool list_time_entries not found",
        ),
    });

    await expect(
      status(ctx, { short: false, idle: "", watch: false }),
    ).rejects.toThrow(VERSION_MISMATCH);
  });

  it("still fails when the optional read fails for another reason", async () => {
    const { ctx } = ajourWith({
      get_last_saved_entry: () => new Error("socket hang up"),
    });

    const failure = await status(ctx, {
      short: false,
      idle: "",
      watch: false,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UnreachableError);
    expect((failure as Error).message).toContain("socket hang up");
  });
});
