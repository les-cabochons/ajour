import { mcpClient, type AjourClient } from "./client.ts";
import { ajourUrl, readToken } from "./config.ts";
import { UnreachableError } from "./errors.ts";
import type { CliIo } from "./io.ts";
import {
  painter,
  shouldColor,
  type ColorMode,
  type Paint,
} from "./format/style.ts";

/** What every command gets: the process, the global options and Ajour. */
export interface Context {
  io: CliIo;
  color: ColorMode;
  /** Paint for stdout, decided from stdout's terminal and the environment. */
  paint: Paint;
  json: boolean;
  quiet: boolean;
  /** The connected client. Throws "Not connected" without a token. */
  client(): Promise<AjourClient>;
  /** Closes the client, if a command opened one. */
  close(): Promise<void>;
}

export const NOT_CONNECTED = "Not connected to Ajour. Run: ajour connect";

export function createContext(
  io: CliIo,
  options: { color: ColorMode; json: boolean; quiet: boolean },
): Context {
  let client: AjourClient | undefined;
  return {
    io,
    ...options,
    paint: painter(
      shouldColor(options.color, { isTTY: io.stdout.isTTY, env: io.env }),
    ),
    async client() {
      if (client) return client;
      const token = await readToken(io);
      if (!token) throw new UnreachableError(NOT_CONNECTED);
      client = mcpClient({ url: ajourUrl(io), token });
      return client;
    },
    async close() {
      await client?.close();
    },
  };
}

/** The local date of `now`, such as 2026-11-04, as Ajour dates its entries. */
export function localDate(now: number): string {
  const date = new Date(now);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
