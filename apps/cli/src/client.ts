import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  BRIDGE_TIMEOUT_MESSAGE,
  BRIDGE_UNAVAILABLE_MESSAGE,
  dataToolOutputSchemas,
  type DataToolOutput,
  type ReadToolInput,
  type ReadToolName,
  type WriteToolInput,
  type WriteToolName,
} from "../../../packages/shared/agent-tools.ts";
import { RefusedError, UnreachableError } from "./errors.ts";

export type ToolName = ReadToolName | WriteToolName;
export type ToolInput<Name extends ToolName> = Name extends ReadToolName
  ? ReadToolInput<Name>
  : Name extends WriteToolName
    ? WriteToolInput<Name>
    : never;

/**
 * The CLI's one way into Ajour: a data tool by name, with the shared
 * contract's input and output. The MCP implementation below talks to the
 * running app; a later data owner that works without the window (#526)
 * implements the same interface.
 */
export interface AjourClient {
  /**
   * Proves the token: Ajour answers the handshake only for a known client.
   * Needs no Ajour window, unlike the data tools.
   */
  check(): Promise<void>;
  call<Name extends ToolName>(
    tool: Name,
    input: ToolInput<Name>,
  ): Promise<DataToolOutput<Name>>;
  close(): Promise<void>;
}

export const NOT_RUNNING = "Ajour isn't running. Start Ajour, then try again.";
export const MCP_OFF = "MCP is off. Turn it on in Ajour under Settings › MCP.";
export const TOKEN_REFUSED =
  "Ajour doesn't accept this token. It may have been revoked. Run: ajour connect";

/** Connects on the first call, so a command that fails early never dials. */
export function mcpClient(options: {
  url: string;
  token: string;
}): AjourClient {
  let connected: Promise<Client> | undefined;
  const connect = async () => {
    const client = new Client({ name: "ajour-cli", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("/mcp/ajour", options.url),
      {
        requestInit: { headers: { Authorization: `Bearer ${options.token}` } },
      },
    );
    try {
      await client.connect(transport);
    } catch (error) {
      throw toCliError(error);
    }
    return client;
  };
  return {
    async check() {
      connected ??= connect();
      await connected;
    },
    async call(tool, input) {
      connected ??= connect();
      const client = await connected;
      let result;
      try {
        result = await client.callTool({ name: tool, arguments: input });
      } catch (error) {
        throw toCliError(error);
      }
      if (result.isError) {
        const message = textOf(result.content);
        throw message === BRIDGE_UNAVAILABLE_MESSAGE ||
          message === BRIDGE_TIMEOUT_MESSAGE
          ? new UnreachableError(message)
          : new RefusedError(message);
      }
      return dataToolOutputSchemas[tool].parse(
        result.structuredContent,
      ) as DataToolOutput<typeof tool>;
    },
    async close() {
      if (!connected) return;
      await (await connected.catch(() => undefined))?.close();
    },
  };
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "Ajour refused the action.";
  const text = content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        part.type === "text" &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || "Ajour refused the action.";
}

/** Turns a transport failure into the sentence the user reads. */
function toCliError(error: unknown): Error {
  if (error instanceof StreamableHTTPError) {
    if (error.code === 404) return new UnreachableError(MCP_OFF);
    if (error.code === 401) return new UnreachableError(TOKEN_REFUSED);
  }
  if (isConnectionFailure(error)) return new UnreachableError(NOT_RUNNING);
  return error instanceof Error ? error : new Error(String(error));
}

function isConnectionFailure(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current && depth < 4;
    current = (current as { cause?: unknown }).cause, depth += 1
  ) {
    const code = (current as { code?: unknown }).code;
    if (
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "EADDRNOTAVAIL" ||
      code === "UND_ERR_SOCKET"
    ) {
      return true;
    }
  }
  return error instanceof TypeError && error.message === "fetch failed";
}
