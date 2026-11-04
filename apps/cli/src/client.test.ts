import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
  mcpClient,
  type ToolSession,
  MCP_OFF,
  NOT_RUNNING,
  TOKEN_REFUSED,
  VERSION_MISMATCH,
  toCliError,
} from "./client.ts";
import { EXIT } from "./errors.ts";

describe("toCliError", () => {
  it.each([
    ["MCP off", new StreamableHTTPError(404, "Not found"), MCP_OFF],
    [
      "a rejected token",
      new StreamableHTTPError(401, "Unknown"),
      TOKEN_REFUSED,
    ],
    [
      "another HTTP answer",
      new StreamableHTTPError(403, "Forbidden"),
      "Ajour's MCP endpoint answered 403. Run: ajour connect",
    ],
    [
      "a request that timed out",
      new McpError(ErrorCode.RequestTimeout, "Request timed out"),
      "Ajour did not answer in time.",
    ],
    [
      "a tool this Ajour doesn't have",
      new McpError(ErrorCode.InvalidParams, "Tool delete_entries not found"),
      VERSION_MISMATCH,
    ],
    [
      "a refused connection",
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      }),
      NOT_RUNNING,
    ],
  ])("reads %s as out of reach", (_name, error, message) => {
    const mapped = toCliError(error);
    expect(mapped.exitCode).toBe(EXIT.unreachable);
    expect(mapped.message).toBe(message);
  });

  it("keeps an unknown failure's own words, still as out of reach", () => {
    const mapped = toCliError(new Error("socket hang up"));
    expect(mapped.exitCode).toBe(EXIT.unreachable);
    expect(mapped.message).toBe("Ajour couldn't be reached: socket hang up");
  });
});

describe("mcpClient sessions", () => {
  /** A session whose calls wait until the test settles them. */
  function session(name: string) {
    const pending: { reject(error: Error): void }[] = [];
    const value: ToolSession & { name: string; closed: boolean } = {
      name,
      closed: false,
      callTool: () =>
        new Promise((_resolve, reject) => pending.push({ reject })),
      close: async () => void (value.closed = true),
    };
    return {
      value,
      failNext: () => pending.shift()!.reject(new Error("socket hang up")),
    };
  }

  it("never drops a newer session for a late failure from an older one", async () => {
    const a = session("A");
    const b = session("B");
    const opened: string[] = [];
    const queue = [a, b];
    const client = mcpClient({
      url: "http://127.0.0.1:9",
      token: "ajour_t",
      open: async () => {
        const next = queue.shift()!;
        opened.push(next.value.name);
        return next.value;
      },
    });

    const first = client.call("get_running_timer", {});
    const second = client.call("get_running_timer", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    a.failNext();
    await expect(first).rejects.toThrow();
    const retry = client.call("get_running_timer", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    a.failNext();
    await expect(second).rejects.toThrow();

    // B is still the session: a third call reuses it instead of opening C.
    void client.call("get_running_timer", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened).toEqual(["A", "B"]);
    expect(b.value.closed).toBe(false);
    await client.close();
    expect(b.value.closed).toBe(true);
    void retry.catch(() => undefined);
  });
});
