/**
 * How Ajour compares project and task names: trimmed, inner spaces collapsed,
 * accents and case ignored. Task imports, the task menu and the terminal's
 * TASK references all match names this way.
 */

const repeatedWhitespacePattern = /\s+/g;
const combiningMarkPattern = /[\u0300-\u036f]/g;

/** The name as it is shown: trimmed, inner spaces collapsed. */
export function formatTaskName(value: string): string {
  return value.trim().replace(repeatedWhitespacePattern, " ");
}

/** The name as it is compared: formatted, then without accents or case. */
export function normalizeTaskName(value: string): string {
  return formatTaskName(value)
    .normalize("NFD")
    .replace(combiningMarkPattern, "")
    .toLowerCase();
}
