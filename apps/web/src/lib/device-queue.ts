/**
 * A list kept per device in localStorage, outside the local app state, such
 * as source writes waiting for their Undo window. Storage stays the source of
 * truth. While it refuses writes, the session keeps the list instead, so the
 * entries still wait until Ajour quits rather than being lost at once.
 */
export function createDeviceQueue<Entry>(
  storageKey: string,
  isEntry: (value: unknown) => value is Entry,
) {
  /** Set only while storage refuses the list. */
  let unsaved: Entry[] | undefined;

  /** Broken entries are dropped. */
  const parse = (value: string | null): Entry[] => {
    try {
      const parsed: unknown = value ? JSON.parse(value) : [];
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  };

  return {
    parse,
    read(): Entry[] {
      if (unsaved) return unsaved;
      try {
        return parse(window.localStorage.getItem(storageKey));
      } catch {
        return [];
      }
    },
    write(entries: Entry[]) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(entries));
        unsaved = undefined;
      } catch {
        unsaved = entries;
      }
    },
  };
}
