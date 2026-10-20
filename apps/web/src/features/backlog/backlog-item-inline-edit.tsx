import { useEffect, useMemo, useRef, useState } from "react";
import {
  MarkdownEditor,
  preloadMarkdownEditor,
} from "@/components/markdown-editor";
import { SectionHeading } from "@/components/section-heading";
import { Input } from "@/components/ui/input";
import { Figure } from "@/components/ui/value";
import { splitDescription } from "@/domain/backlog/description-frontmatter";
import type {
  LocalWorkItem,
  LocalWorkItemEstimateFieldKey,
} from "@/domain/local-state";
import { formatHours } from "@/features/backlog/backlog-estimates";
import { patchBacklogItemWithUndo } from "@/features/backlog/backlog-item-surface";
import { DescriptionText } from "@/features/backlog/description-links";
import {
  buildBacklogTaskDraft,
  createBacklogTaskEditorSeed,
  formatEstimateInput,
  parseEstimateInput,
} from "@/features/backlog/backlog-task-editor";
import { clearDescriptionDraftConflict } from "@/lib/description-save";
import { localStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";
import {
  DescriptionLength,
  DescriptionSaveStatus,
  SourceChangedWarning,
  SyncedDescriptionNote,
  isOverDescriptionLimit,
  confirmDescriptionLoss,
  saveDescriptionToSource,
  useDescriptionAccess,
  useDescriptionLimit,
  followDescriptionDraft,
  useSourceDescriptionCheck,
  writesToSource,
} from "@/features/backlog/synced-description";
import {
  descriptionLosses,
  normalizeDescriptionText,
} from "@/domain/backlog/description-sync";
import { SyncConflictButton } from "@/features/backlog/sync-conflicts";

/*
 * The backlog item page edits in place: each field below saves on Enter or
 * when focus leaves it, with the Undo toast, and Escape puts the saved value
 * back. They replace the editor side panel on the page.
 */

/**
 * Runs `save` once when an inline field closes, so Enter followed by the blur
 * of the unmounting input does not save twice.
 */
function useCloseOnce(onClose: () => void) {
  const closedRef = useRef(false);
  return {
    reset: () => {
      closedRef.current = false;
    },
    close: (save?: () => void) => {
      if (closedRef.current) return;
      closedRef.current = true;
      save?.();
      onClose();
    },
  };
}

/** The item's title. Click it, or press Enter on the page, to rename it. */
export function InlineTitle({
  item,
  editing,
  readOnly,
  onEditingChange,
}: {
  item: LocalWorkItem;
  editing: boolean;
  readOnly: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const closer = useCloseOnce(() => onEditingChange(false));
  if (!editing || readOnly) {
    return (
      <h1
        className={cn(
          "backlog-item-page-title",
          !readOnly && "backlog-item-inline-target",
        )}
        onClick={() => {
          if (readOnly) return;
          closer.reset();
          onEditingChange(true);
        }}
      >
        {item.title}
      </h1>
    );
  }

  const save = (value: string) => {
    const title = value.trim();
    // An empty title keeps the saved one.
    if (title && title !== item.title) {
      patchBacklogItemWithUndo(item, { title }, "Title changed");
    }
  };
  return (
    <Input
      autoFocus
      aria-label="Title"
      defaultValue={item.title}
      className="backlog-item-page-title h-auto px-1.5 py-0.5"
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => {
        const { value } = event.currentTarget;
        closer.close(() => save(value));
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          const { value } = event.currentTarget;
          closer.close(() => save(value));
        } else if (event.key === "Escape") {
          event.preventDefault();
          closer.close();
        }
      }}
    />
  );
}

/** One estimate figure. Click the number to type new hours; empty clears it. */
export function EstimateFigure({
  item,
  field,
  label,
  conflict,
  readOnly,
}: {
  item: LocalWorkItem;
  field: LocalWorkItemEstimateFieldKey;
  label: string;
  conflict: boolean;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Set once the field closes, so the blur of the unmounting input after
  // Enter or Escape does not save again.
  const closedRef = useRef(false);
  const invalid = draft !== null && parseEstimateInput(draft) === null;

  function open() {
    closedRef.current = false;
    setDraft(formatEstimateInput(item[field]));
  }

  function close() {
    closedRef.current = true;
    setDraft(null);
  }

  function save() {
    if (draft === null || closedRef.current) return;
    // Untouched text saves nothing, so a precise synced value is not rounded.
    if (draft === formatEstimateInput(item[field])) {
      close();
      return;
    }
    const hours = parseEstimateInput(draft);
    // Invalid hours keep the field open with its error.
    if (hours === null) return;
    patchBacklogItemWithUndo(
      item,
      { [field]: hours },
      `${label} estimate changed`,
    );
    close();
  }

  return (
    <Figure label={label}>
      {draft === null ? (
        <button
          type="button"
          className="backlog-item-inline-target -mx-1 px-1 disabled:cursor-default"
          aria-label={`Edit ${label.toLowerCase()} estimate, ${formatHours(item[field])}`}
          disabled={readOnly}
          onClick={open}
        >
          {formatHours(item[field])}
        </button>
      ) : (
        <Input
          autoFocus
          inputMode="decimal"
          aria-label={`${label} estimate in hours`}
          aria-invalid={invalid}
          title={invalid ? "Enter a non-negative number" : undefined}
          value={draft}
          placeholder="0"
          className="h-7 w-20 px-1 font-mono text-lg"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        />
      )}
      {conflict ? (
        <span className="ml-1.5 inline-flex items-center gap-1 font-sans text-xs font-normal text-destructive">
          Conflict
          <SyncConflictButton item={item} />
        </span>
      ) : null}
    </Figure>
  );
}

/**
 * The description section. The rendered markdown has a subtle Edit beside its
 * heading that swaps it for the Markdown editor. The rendered text leaves out
 * the frontmatter, which the properties card shows and the editor keeps.
 */
export function DescriptionSection({
  item,
  readOnly,
}: {
  item: LocalWorkItem;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const closer = useCloseOnce(() => setEditing(false));
  // The text the editor opened on, and what it holds now. A sync can change
  // the description under an open editor; an untouched draft follows it, and
  // one the user did not change is never saved over it.
  const current = item.description ?? "";
  const [base, setBase] = useState(current);
  const [draft, setDraft] = useState(current);
  const access = useDescriptionAccess(item);
  const writes = writesToSource(item, access);
  useEffect(() => {
    if (!editing || current === base) return;
    // A description written to its source takes the source's change in, so
    // saving it never reverts that change.
    setDraft((text) =>
      text === base
        ? current
        : writes
          ? followDescriptionDraft(item._id, base, text, current)
          : text,
    );
    setBase(current);
  }, [editing, current, base, writes, item._id]);
  const editable = !readOnly && access.editable;
  const limit = useDescriptionLimit(item, access);
  const latest = useSourceDescriptionCheck(
    item,
    editing && editable && writesToSource(item, access),
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const body = useMemo(
    () => (item.description ? splitDescription(item.description).body : ""),
    [item.description],
  );

  const save = (value: string, allowedLoss: readonly string[] = []) => {
    if (normalizeDescriptionText(value) === normalizeDescriptionText(base))
      return;
    const description = normalizeDescriptionText(value) || undefined;
    if (description === item.description) return;
    if (writesToSource(item, access)) {
      saveDescriptionToSource(item._id, description, allowedLoss);
    } else {
      patchBacklogItemWithUndo(item, { description }, "Description changed");
    }
  };
  // A save that would lose formatting asks first; the editor stays open
  // while it does, and after Cancel.
  const confirming = useRef(false);
  const leave = async (value: string) => {
    // Text over the limit is not saved, so the editor stays open on it.
    if (isOverDescriptionLimit(value, limit) || confirming.current) return;
    const changed =
      normalizeDescriptionText(value) !== normalizeDescriptionText(base);
    if (
      changed &&
      writesToSource(item, access) &&
      descriptionLosses(item).length > 0
    ) {
      confirming.current = true;
      const allowedLoss = await confirmDescriptionLoss(item);
      confirming.current = false;
      if (allowedLoss) closer.close(() => save(value, allowedLoss));
      return;
    }
    closer.close(() => save(value));
  };
  return (
    <>
      <SectionHeading
        trailing={
          <>
            {item.descriptionSync?.conflict ? (
              <span className="flex items-center gap-1 text-xs text-destructive">
                Conflict
                <SyncConflictButton item={item} />
              </span>
            ) : null}
            {!editing && editable ? (
              <button
                type="button"
                className="backlog-item-subtle-action"
                onPointerEnter={preloadMarkdownEditor}
                onFocus={preloadMarkdownEditor}
                onClick={() => {
                  closer.reset();
                  clearDescriptionDraftConflict(item._id);
                  setBase(current);
                  setDraft(current);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            ) : null}
          </>
        }
      >
        Description
      </SectionHeading>
      {editing && editable ? (
        <div
          ref={wrapperRef}
          // Leaving the warning's button for outside leaves the editor too.
          onBlur={(event) => {
            if (
              event.target instanceof HTMLButtonElement &&
              !wrapperRef.current?.contains(event.relatedTarget)
            ) {
              leave(draft);
            }
          }}
        >
          <MarkdownEditor
            autoFocus
            aria-label="Description"
            value={draft}
            onChange={setDraft}
            placeholder="Markdown supported"
            minLines={4}
            onBlur={(value, next) => {
              // Focus moving to the warning's Load latest keeps it open.
              if (next && wrapperRef.current?.contains(next)) return;
              leave(value);
            }}
            onSubmit={leave}
            onCancel={() => closer.close()}
          />
          <DescriptionLength text={draft} limit={limit} />
          <SourceChangedWarning
            item={item}
            latest={latest}
            typed={draft !== base}
          />
        </div>
      ) : body ? (
        <DescriptionText body={body} />
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
      <DescriptionSaveStatus item={item} access={access} />
      <SyncedDescriptionNote item={item} access={access} />
    </>
  );
}

/**
 * The name field under the subitem list, shown while `adding`: the Subitems
 * card's + opens it. Enter creates a subitem with the parent's project and
 * task, and the field stays open for the next one. Escape, or leaving it
 * empty, closes it.
 */
export function AddSubitemRow({
  parent,
  adding,
  onClose,
}: {
  parent: LocalWorkItem;
  adding: boolean;
  /** `escaped` when Escape closed it, so the caller can take focus back. */
  onClose: (escaped: boolean) => void;
}) {
  const [title, setTitle] = useState("");

  function create() {
    const draft = buildBacklogTaskDraft(
      { ...createBacklogTaskEditorSeed({ kind: "create", parent }), title },
      { isSubtask: true, requireParent: true },
    );
    if (!draft) return;
    localStore.addWorkItem(draft);
    setTitle("");
  }

  if (!adding) return null;

  return (
    <Input
      autoFocus
      aria-label="New subitem name"
      placeholder="Subitem name, Enter to add"
      value={title}
      className="mt-1"
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => {
        if (!title.trim()) onClose(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          create();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setTitle("");
          onClose(true);
        }
      }}
    />
  );
}
