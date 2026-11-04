import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { UnreachableError, UsageError } from "./errors.ts";
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

/**
 * Whether `token` can go in an Authorization header. Ajour's tokens are
 * printable ASCII without spaces. Anything else is refused before it reaches
 * the HTTP client, whose errors would quote it.
 */
export function isWellFormedToken(token: string): boolean {
  return /^[\x21-\x7e]{1,512}$/.test(token);
}

/**
 * AJOUR_TOKEN, else the saved token, else undefined. A malformed token is
 * refused with a fixed sentence that never quotes it.
 */
export async function readToken(io: CliIo): Promise<string | undefined> {
  const fromEnv = io.env.AJOUR_TOKEN?.trim();
  if (fromEnv) {
    if (!isWellFormedToken(fromEnv)) {
      throw new UnreachableError(
        "AJOUR_TOKEN isn't a token Ajour created. Run: ajour connect",
      );
    }
    return fromEnv;
  }
  let saved: string;
  try {
    saved = (await readFile(tokenPath(io), "utf8")).trim();
  } catch {
    return undefined;
  }
  if (!saved) return undefined;
  if (!isWellFormedToken(saved)) {
    throw new UnreachableError(
      "The saved token isn't a token Ajour created. Run: ajour connect",
    );
  }
  return saved;
}

/** Checks a token the user typed or piped in, without quoting it back. */
export function parseTokenInput(raw: string): string {
  const token = raw.trim();
  if (!token) throw new UsageError("No token was given.");
  if (!isWellFormedToken(token)) {
    throw new UsageError("That isn't a token Ajour created.");
  }
  return token;
}

/** Saves the token readable by the user alone, like gh's hosts file. */
export async function saveToken(io: CliIo, token: string): Promise<string> {
  const file = tokenPath(io);
  await writePrivateFile(file, `${token}\n`);
  return file;
}

/**
 * Writes `text` readable by the user alone. It is written to a new private
 * file first, then renamed over the old one, so an existing file with wider
 * rights never holds the new text. The rename replaces a symlink at that
 * path rather than writing through it.
 */
export async function writePrivateFile(
  file: string,
  text: string,
): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    dir,
    `.${path.basename(file)}-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Where the last write's Undo token waits for `ajour undo`. */
export function undoPath(io: CliIo): string {
  return path.join(stateDir(io), "last-undo");
}

/**
 * Keeps a write's Undo token for `ajour undo`, privately like the token. A
 * write that offered no Undo changed nothing, so the token kept before it
 * still names Ajour's last action and stays.
 */
export async function rememberUndo(
  io: CliIo,
  undoToken: string | null,
): Promise<void> {
  if (undoToken) await writePrivateFile(undoPath(io), `${undoToken}\n`);
}

/** An Undo token one `ajour undo` took for itself, in its own file. */
export interface ClaimedUndo {
  undoToken: string;
  file: string;
}

/**
 * Takes the kept Undo token for one `ajour undo`, or undefined when there is
 * none. last-undo is renamed to a name of this run's own first, which is
 * atomic in one folder: two undos never both take it, and a write that lands
 * meanwhile keeps a new last-undo that this run never removes.
 */
export async function claimUndo(io: CliIo): Promise<ClaimedUndo | undefined> {
  const kept = undoPath(io);
  const file = path.join(
    path.dirname(kept),
    `.last-undo-claimed-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    await rename(kept, file);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  const undoToken = (await readFile(file, "utf8")).trim();
  if (undoToken) return { undoToken, file };
  await rm(file, { force: true });
  return undefined;
}

/** Throws the claimed token away: used, or refused. */
export async function forgetClaimedUndo(claim: ClaimedUndo): Promise<void> {
  await rm(claim.file, { force: true });
}

/**
 * Puts a claimed token back as last-undo for a later try, unless a write
 * stored a newer one meanwhile, which then names Ajour's last action. The
 * link creates last-undo only where none exists, whole and private, as the
 * claimed file is.
 */
export async function restoreClaimedUndo(
  io: CliIo,
  claim: ClaimedUndo,
): Promise<void> {
  try {
    await link(claim.file, undoPath(io));
  } catch (error) {
    if (!isAlreadyThere(error)) {
      // A file system without hard links: copy, still only where none is.
      await copyFile(claim.file, undoPath(io), constants.COPYFILE_EXCL).catch(
        (copyError: unknown) => {
          if (!isAlreadyThere(copyError)) throw copyError;
        },
      );
    }
  } finally {
    await rm(claim.file, { force: true });
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isAlreadyThere(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}
