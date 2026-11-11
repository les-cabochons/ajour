import { Button } from "@/components/ui/button";
import { MessagePanel } from "@/components/app-surface";

/** A field of a kept draft that the saved record changed too. */
export interface DraftConflictView {
  id: string;
  /** What the field is called, such as "Hours". */
  label: string;
  /** The record's value now, as the field shows it. */
  theirs: string;
  /** The draft's value, as the field shows it. */
  mine: string;
}

/**
 * Shown above a composer that resumed a kept draft when the saved record
 * changed in a field the draft changed too, in another window or by a sync.
 * Nothing is overwritten: the draft cannot be saved until each field has an
 * answer, "Keep mine" or "Use theirs".
 */
export function DraftConflictNotice({
  conflicts,
  onKeepMine,
  onUseTheirs,
}: {
  conflicts: readonly DraftConflictView[];
  onKeepMine: (id: string) => void;
  onUseTheirs: (id: string) => void;
}) {
  if (conflicts.length === 0) return null;
  return (
    <MessagePanel
      tone="warning"
      role="group"
      aria-label="Changed elsewhere"
      className="flex flex-col gap-2 text-[13px]"
    >
      {conflicts.map((conflict) => (
        <div key={conflict.id} className="flex flex-col gap-1.5">
          <p className="m-0 font-medium">{conflict.label} changed</p>
          <p className="m-0 min-w-0 break-words text-[var(--text-secondary)]">
            Now {conflict.theirs || "empty"}. Your draft has{" "}
            {conflict.mine || "empty"}.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onKeepMine(conflict.id)}
            >
              Keep mine
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onUseTheirs(conflict.id)}
            >
              Use theirs
            </Button>
          </div>
        </div>
      ))}
    </MessagePanel>
  );
}
