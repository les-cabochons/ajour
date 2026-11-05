import { BRIDGE_UNAVAILABLE_MESSAGE } from "../../../../packages/shared/agent-tools.ts";
import { mcpClient } from "../client.ts";
import { ajourUrl, parseTokenInput, saveToken } from "../config.ts";
import type { Context } from "../context.ts";
import { UnreachableError } from "../errors.ts";

export interface ConnectOptions {
  /** Read the token from standard input, for scripts and password managers. */
  tokenStdin: boolean;
}

export const WINDOW_CLOSED_NOTE =
  "Ajour's window isn't open, so commands can't read your entries yet. Open Ajour to use them.";

/**
 * Pairs the terminal with Ajour. The MCP handshake proves the token, which
 * needs no Ajour window; nothing is saved when Ajour refuses it. Then a read
 * checks that the window answers: when it doesn't, the token is still saved,
 * since it works, and the user is told to open Ajour.
 */
export async function connect(
  ctx: Context,
  options: ConnectOptions,
): Promise<number> {
  const { io } = ctx;
  if (!options.tokenStdin) {
    io.stderr.write(
      'In Ajour, open Settings › MCP, turn MCP on and create a client named "Terminal".\n',
    );
  }
  const token = parseTokenInput(
    options.tokenStdin
      ? await io.readStdin()
      : await io.readSecret("Paste its token: "),
  );

  const url = ajourUrl(io);
  const transport = await io.transport?.(url);
  const client = mcpClient({ url, token, fetch: transport?.fetch });
  let windowOpen = true;
  try {
    await client.check();
    const file = await saveToken(io, token);
    try {
      await client.call("get_running_timer", {});
    } catch (error) {
      if (
        !(error instanceof UnreachableError) ||
        error.message !== BRIDGE_UNAVAILABLE_MESSAGE
      ) {
        throw error;
      }
      windowOpen = false;
    }
    if (!ctx.quiet) {
      io.stderr.write(
        `Connected to Ajour on ${url}. The token is saved in ${file}.\n`,
      );
    }
  } finally {
    try {
      await client.close();
    } finally {
      transport?.close();
    }
  }
  if (!windowOpen) io.stderr.write(`${WINDOW_CLOSED_NOTE}\n`);
  return 0;
}
