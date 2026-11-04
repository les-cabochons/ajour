/**
 * An entry's short id, as the terminal prints it and resolves it: the UUID
 * in the entry's `_id`, after its prefix such as `timesheet_`, with the
 * dashes removed and in lowercase. An `_id` without a UUID, from an older
 * version, is its own short id, unchanged. The CLI and Ajour both derive it
 * here, so they agree. It is not the Workday `externalId`.
 */

const PREFIXED_UUID =
  /^(?:[A-Za-z][A-Za-z0-9_]*_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The short id of an entry, or of the running entry, from its `_id`. */
export function entryShortId(id: string): string {
  const uuid = PREFIXED_UUID.exec(id)?.[1];
  return uuid ? uuid.replaceAll("-", "").toLowerCase() : id;
}

/** Whether the short id of `id` starts with `prefix`. */
export function matchesShortIdPrefix(id: string, prefix: string): boolean {
  return entryShortId(id).startsWith(prefix);
}
