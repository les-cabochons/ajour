// Implementation: private to the package. Only files in packages/example import it.

export function splitWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

export function joinWords(words: string[], separator: string): string {
  return words.join(separator);
}
