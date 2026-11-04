import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
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
