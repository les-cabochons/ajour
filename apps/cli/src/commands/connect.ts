import { mcpClient } from "../client.ts";
import { ajourUrl, saveToken } from "../config.ts";
import type { Context } from "../context.ts";
import { UsageError } from "../errors.ts";

export interface ConnectOptions {
  /** Read the token from standard input, for scripts and password managers. */
  tokenStdin: boolean;
}

/**
 * Pairs the terminal with Ajour: checks a token created in Settings › MCP
 * against the running app, then saves it. Nothing is saved when Ajour
 * refuses it.
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
  const raw = options.tokenStdin
    ? await io.readStdin()
    : await io.readSecret("Paste its token: ");
  const token = raw.trim().split(/\s+/)[0] ?? "";
  if (!token) throw new UsageError("No token was given.");

  const url = ajourUrl(io);
  const client = mcpClient({ url, token });
  try {
    await client.check();
  } finally {
    await client.close();
  }
  const file = await saveToken(io, token);
  if (!ctx.quiet) {
    io.stderr.write(
      `Connected to Ajour on ${url}. The token is saved in ${file}.\n`,
    );
  }
  return 0;
}
