/**
 * The five color roles the CLI prints with. Plain 16-color codes, so the
 * user's terminal theme decides the actual colors.
 */

export type ColorMode = "auto" | "always" | "never";

/**
 * Whether to print color. `always` and `never` win. Otherwise a non-empty
 * NO_COLOR turns it off (no-color.org), CLICOLOR_FORCE other than "0" turns
 * it on in a pipe, and a terminal that isn't "dumb" gets color.
 */
export function shouldColor(
  mode: ColorMode,
  stream: { isTTY: boolean; env: Readonly<Record<string, string | undefined>> },
): boolean {
  if (mode !== "auto") return mode === "always";
  if (stream.env.NO_COLOR) return false;
  const force = stream.env.CLICOLOR_FORCE;
  if (force !== undefined && force !== "" && force !== "0") return true;
  return stream.isTTY && stream.env.TERM !== "dumb";
}

export interface Paint {
  /** Headers and the range a print covers. */
  accent(text: string): string;
  /** Totals and the counted time. */
  bold(text: string): string;
  /** Ids, separators, targets and secondary text. */
  muted(text: string): string;
  /** The running entry. */
  success(text: string): string;
  /** Under target, Not known yet, a committed entry that changed. */
  warning(text: string): string;
  /** The label before an error. */
  error(text: string): string;
}

const CODES: Record<keyof Paint, string> = {
  accent: "1;34",
  bold: "1",
  muted: "90",
  success: "32",
  warning: "33",
  error: "1;31",
};

export function painter(color: boolean): Paint {
  const role = (code: string) => (text: string) =>
    color && text ? `\x1b[${code}m${text}\x1b[0m` : text;
  return {
    accent: role(CODES.accent),
    bold: role(CODES.bold),
    muted: role(CODES.muted),
    success: role(CODES.success),
    warning: role(CODES.warning),
    error: role(CODES.error),
  };
}
