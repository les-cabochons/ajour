import type { FieldsOf, AjourCatalog } from "@ajour/wide-events/catalog.ts";
import { recordsEqual } from "@/domain/records-equal";
import { wideEvents } from "@/lib/wide-events";

type PreferenceFields = NonNullable<
  FieldsOf<AjourCatalog, "preferences.update">["preferences"]
>;

/**
 * Which settings keys changed between `before` and `after`, and the values of
 * those that are numbers, booleans or one of `enumKeys`. Other values, such as
 * a filter's text or a name source, stay out (ADR 0011).
 */
export function describePreferenceChange(
  before: object,
  after: object,
  enumKeys: readonly string[] = [],
): Pick<PreferenceFields, "changed_keys" | "values"> {
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  const changed: string[] = [];
  const values: Record<string, string | number | boolean> = {};
  for (const key of new Set([...Object.keys(next), ...Object.keys(previous)])) {
    if (recordsEqual(previous[key], next[key])) continue;
    changed.push(key);
    const value = next[key];
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      (typeof value === "string" && enumKeys.includes(key))
    ) {
      values[key] = value;
    }
  }
  return { changed_keys: changed, values };
}

/**
 * Emits `preferences.update` for a device UI setting that changed from
 * `before` to `after`: `noop` when nothing did. Device settings live outside
 * the local state, so they are not store commands.
 */
export function recordDeviceSettingChange(
  setting: Exclude<PreferenceFields["setting"], "user_preferences" | undefined>,
  before: object,
  after: object,
  enumKeys: readonly string[] = [],
) {
  wideEvents.run(
    "preferences.update",
    { kind: "command", trigger: "user" },
    (unit) => {
      const change = describePreferenceChange(before, after, enumKeys);
      unit.set({ preferences: { scope: "device", setting, ...change } });
      if (change.changed_keys?.length === 0) unit.end("noop");
    },
  );
}
