/**
 * What a thrown value is, without what it says: its type name and its code,
 * such as a Node error's `ENOENT`. Safe for any event: it holds no content.
 */
export function errorIdentity(error: unknown): { type: string; code?: string } {
  const type =
    error instanceof Error
      ? error.name
      : error === null
        ? "null"
        : typeof error;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? { type, code } : { type };
}
