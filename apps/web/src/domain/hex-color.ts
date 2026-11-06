/** What the color fields and imports say about a color they refuse. */
export const HEX_COLOR_ERROR = "Enter a hex color, such as #4f46e5 or #fff.";

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A color as the user typed it, as the "#rrggbb" Ajour stores, or null when
 * it isn't one. The "#" is optional and three digits stand for six, as in
 * CSS: "#fff" and "ff8800" read as "#ffffff" and "#ff8800". Seven digits or
 * a name such as "red" are refused, never cut short.
 */
export function normalizeHexColor(text: string): string | null {
  const match = HEX_COLOR_PATTERN.exec(text.trim());
  if (!match) return null;
  const digits = match[1]!.toLowerCase();
  return `#${
    digits.length === 3
      ? [...digits].map((digit) => `${digit}${digit}`).join("")
      : digits
  }`;
}
