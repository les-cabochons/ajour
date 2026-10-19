/**
 * A list kept per device in localStorage, outside the local app state, such
 * as source writes waiting for their Undo window. The session keeps its own
 * copy, so when storage refuses a write the entries still wait until Ajour
 * quits instead of being lost at once.
 */
export function createDeviceQueue<Entry>(
  storageKey: string,
  isEntry: (value: unknown) => value is Entry,
) {
  let session: Entry[] | undefined;

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
      if (!session) {
        try {
          session = parse(window.localStorage.getItem(storageKey));
        } catch {
          session = [];
        }
      }
      return session;
    },
    write(entries: Entry[]) {
      session = entries;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(entries));
      } catch {
        // The session copy keeps them until Ajour quits.
      }
    },
  };
}
