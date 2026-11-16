// Whether recorded wide events hold a value (ADR 0011: events hold ids and
// outcomes, never argv, values, paths or content). The checks compare every
// string in the events, keys included, to the value itself, never search the
// events' JSON: JSON escapes `\` and `"`, so a leaked `C:\repo` or `a"b c"d`
// would not be found in it.
"use strict";

/** Every string in `value`, deeply: strings, object keys and their values. */
function stringsIn(value, found = [], seen = new Set()) {
  if (typeof value === "string") {
    found.push(value);
    return found;
  }
  if (value === null || typeof value !== "object" || seen.has(value))
    return found;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      stringsIn(key, found, seen);
      stringsIn(entry, found, seen);
    }
    return found;
  }
  if (Array.isArray(value) || value instanceof Set) {
    for (const entry of value) stringsIn(entry, found, seen);
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    found.push(key);
    stringsIn(entry, found, seen);
  }
  return found;
}

/** Whether any string in `events` contains `text`. */
function eventsHold(events, text) {
  return stringsIn(events).some((value) => value.includes(text));
}

module.exports = { stringsIn, eventsHold };
