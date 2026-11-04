import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliIo } from "./io.ts";

/** Where Ajour's local API listens unless AJOUR_URL says otherwise. */
export const DEFAULT_URL = "http://127.0.0.1:8787";

export function ajourUrl(io: CliIo): string {
  return io.env.AJOUR_URL?.trim() || DEFAULT_URL;
}

/**
 * The folder for the saved token: $XDG_CONFIG_HOME/ajour, else
 * ~/.config/ajour, and %APPDATA%\ajour on Windows.
 */
export function configDir(io: CliIo): string {
  const xdg = io.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, "ajour");
  if (io.platform === "win32" && io.env.APPDATA) {
    return path.join(io.env.APPDATA, "ajour");
  }
  return path.join(io.homedir, ".config", "ajour");
}

/**
 * The folder for what the CLI remembers between runs, such as the last
 * Undo: $XDG_STATE_HOME/ajour, else ~/.local/state/ajour, and
 * %LOCALAPPDATA%\ajour on Windows.
 */
export function stateDir(io: CliIo): string {
  const xdg = io.env.XDG_STATE_HOME?.trim();
  if (xdg) return path.join(xdg, "ajour");
  if (io.platform === "win32" && io.env.LOCALAPPDATA) {
    return path.join(io.env.LOCALAPPDATA, "ajour");
  }
  return path.join(io.homedir, ".local", "state", "ajour");
}

export function tokenPath(io: CliIo): string {
  return path.join(configDir(io), "token");
}

/** AJOUR_TOKEN, else the saved token, else undefined. */
export async function readToken(io: CliIo): Promise<string | undefined> {
  const fromEnv = io.env.AJOUR_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return (await readFile(tokenPath(io), "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Saves the token readable by the user alone, like gh's hosts file. The
 * chmod also narrows a file an older run created with wider rights.
 */
export async function saveToken(io: CliIo, token: string): Promise<string> {
  const file = tokenPath(io);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}
