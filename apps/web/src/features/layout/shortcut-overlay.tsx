import { Fragment, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useShortcut } from "@/lib/shortcut-handlers";
import {
  SHORTCUTS,
  filterShortcuts,
  formatShortcutKeys,
  getShortcutPlatform,
  type ShortcutScope,
} from "@/lib/shortcuts";

const platform = getShortcutPlatform();

const SCOPE_HEADINGS: Record<ShortcutScope, string> = {
  global: "Anywhere",
  time: "Time page",
};

/**
 * The "?" overlay. It lists every shortcut in `lib/shortcuts.ts`, grouped by
 * where it works, with a search field over labels and keys.
 */
export function ShortcutOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visibleShortcuts = useMemo(
    () => filterShortcuts(SHORTCUTS, query, platform),
    [query],
  );

  useShortcut(
    "app.shortcuts",
    () => {
      setQuery("");
      setIsOpen(true);
    },
    "app",
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single keys work when focus is not in a text field.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
          autoFocus
        />
        <div className="max-h-[60vh] overflow-y-auto">
          {visibleShortcuts.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              No shortcut matches "{query.trim()}".
            </p>
          ) : (
            (Object.keys(SCOPE_HEADINGS) as ShortcutScope[]).map((scope) => {
              const shortcuts = visibleShortcuts.filter(
                (shortcut) => shortcut.scope === scope,
              );
              if (shortcuts.length === 0) {
                return null;
              }

              return (
                <section key={scope} aria-label={SCOPE_HEADINGS[scope]}>
                  <h3 className="pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {SCOPE_HEADINGS[scope]}
                  </h3>
                  <ul>
                    {shortcuts.map((shortcut) => (
                      <li
                        key={shortcut.id}
                        className="flex items-center justify-between gap-4 py-1.5"
                      >
                        <span>{shortcut.label}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          {formatShortcutKeys(shortcut, platform).map(
                            (label, index) => (
                              <Fragment key={index}>
                                {index > 0 ? <span>then</span> : null}
                                <kbd className="min-w-6 rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-foreground">
                                  {label}
                                </kbd>
                              </Fragment>
                            ),
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
