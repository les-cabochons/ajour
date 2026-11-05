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
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
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
  serverVersion?(): Promise<string | undefined>;
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

/** The part of the MCP SDK's client the CLI uses, so tests can stand in. */
export interface ToolSession {
  serverVersion?: string;
  callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{
    isError?: boolean;
    content?: unknown;
    structuredContent?: unknown;
  }>;
  close(): Promise<void>;
}

/**
 * Connects on the first call, so a command that fails early never dials. A
 * failed connection or call is forgotten, so the next call dials again: a
 * `--watch` started before Ajour picks it up once it runs. Only the session
 * that failed is forgotten: a late failure from an older one never drops a
 * newer one.
 */
export function mcpClient(options: {
  url: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  /** Opens a session. Tests pass their own; the default is the MCP SDK's. */
  open?: () => Promise<ToolSession>;
}): AjourClient {
  let connected: Promise<ToolSession> | undefined;
  const connect = async (): Promise<ToolSession> => {
    if (options.open) return options.open();
    const client = new Client({ name: "ajour-cli", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("/mcp/ajour", options.url),
      {
        fetch: options.fetch,
        requestInit: { headers: { Authorization: `Bearer ${options.token}` } },
      },
    );
    try {
      await client.connect(transport);
    } catch (error) {
      throw toCliError(error);
    }
    return {
      // The SDK types a compatibility result too; Ajour's server sends the
      // current shape, which `call` reads defensively below.
      serverVersion:
        client.getServerVersion()?.version === "unknown"
          ? undefined
          : client.getServerVersion()?.version,
      callTool: (params) =>
        client.callTool(params) as ReturnType<ToolSession["callTool"]>,
      close: () => client.close(),
    };
  };
  const forget = (failed: Promise<ToolSession>) => {
    if (connected === failed) connected = undefined;
  };
  const session = async () => {
    const current = (connected ??= connect());
    try {
      return { current, session: await current };
    } catch (error) {
      forget(current);
      throw error;
    }
  };
  return {
    async serverVersion() {
      return (await session()).session.serverVersion;
    },
    async check() {
      await session();
    },
    async call(tool, input) {
      const { current, session: open } = await session();
      let result;
      try {
        result = await open.callTool({
          name: tool,
          arguments: input as Record<string, unknown>,
        });
      } catch (error) {
        if (connected === current) {
          forget(current);
          void open.close().catch(() => undefined);
        }
        throw toCliError(error);
      }
      if (result.isError) {
        const message = textOf(result.content);
        throw message === BRIDGE_UNAVAILABLE_MESSAGE ||
          message === BRIDGE_TIMEOUT_MESSAGE
          ? new UnreachableError(message)
          : new RefusedError(message);
      }
      const parsed = dataToolOutputSchemas[tool].safeParse(
        result.structuredContent,
      );
      if (!parsed.success) throw new UnreachableError(VERSION_MISMATCH);
      return parsed.data as DataToolOutput<typeof tool>;
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

export const VERSION_MISMATCH = "Update Ajour to use this command.";

/**
 * Turns a transport or protocol failure into the sentence the user reads.
 * Every one is "out of reach" (exit 3): only a tool's own error result is a
 * refusal. The SDK's own message is kept for an unknown failure, but the
 * token never reaches it: config.ts refuses a token that isn't well formed.
 */
export function toCliError(error: unknown): UnreachableError {
  if (error instanceof UnreachableError) return error;
  if (error instanceof StreamableHTTPError) {
    if (error.code === 404) return new UnreachableError(MCP_OFF);
    if (error.code === 401) return new UnreachableError(TOKEN_REFUSED);
    return new UnreachableError(
      `Ajour's MCP endpoint answered ${error.code}. Run: ajour connect`,
    );
  }
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) {
      return new UnreachableError(BRIDGE_TIMEOUT_MESSAGE);
    }
    if (
      error.code === ErrorCode.MethodNotFound ||
      (error.code === ErrorCode.InvalidParams &&
        /not found/i.test(error.message))
    ) {
      return new UnreachableError(VERSION_MISMATCH);
    }
  }
  if (isConnectionFailure(error)) return new UnreachableError(NOT_RUNNING);
  const message = error instanceof Error ? error.message : String(error);
  return new UnreachableError(`Ajour couldn't be reached: ${message}`);
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
