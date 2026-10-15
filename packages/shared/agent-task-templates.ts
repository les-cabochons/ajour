/**
 * Slots in agent task prompts and week links: `{{weekOf}}`, `{{sessionId}}`
 * and `{{settings.<id>}}`. Ajour fills them; a slot it has no value for is
 * an error, never a blank.
 */

const SLOT_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/g;

/** The slots every task may use. Settings slots depend on the task. */
export const AGENT_TASK_SLOTS = ["weekOf", "sessionId"] as const;

export class UnknownSlotError extends Error {
  readonly slot: string;

  constructor(slot: string) {
    super(`The template uses {{${slot}}}, which Ajour does not fill.`);
    this.name = "UnknownSlotError";
    this.slot = slot;
  }
}

/** Each slot name once, in the order it first appears. */
export function listTemplateSlots(template: string): string[] {
  return [...new Set([...template.matchAll(SLOT_PATTERN)].map((m) => m[1]!))];
}

/** Replaces every slot. Throws UnknownSlotError for a slot without a value. */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(SLOT_PATTERN, (_match, slot: string) => {
    const value = values[slot];
    if (value === undefined) throw new UnknownSlotError(slot);
    return value;
  });
}

/** The slots a task may use: the fixed ones and one per settings field. */
export function allowedTaskSlots(settingIds: readonly string[]): Set<string> {
  return new Set([
    ...AGENT_TASK_SLOTS,
    ...settingIds.map((id) => `settings.${id}`),
  ]);
}
