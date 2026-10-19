import { useRef, useState } from "react";
import { RiAddLine as AddIcon } from "@remixicon/react";
import { Markdown } from "@/components/markdown";
import {
  MarkdownEditor,
  preloadMarkdownEditor,
} from "@/components/markdown-editor";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Figure } from "@/components/ui/value";
import type {
  LocalWorkItem,
  LocalWorkItemEstimateFieldKey,
} from "@/domain/local-state";
import { formatHours } from "@/features/backlog/backlog-estimates";
import { patchBacklogItemWithUndo } from "@/features/backlog/backlog-item-surface";
import {
  buildBacklogTaskDraft,
  createBacklogTaskEditorSeed,
  formatEstimateInput,
  parseEstimateInput,
} from "@/features/backlog/backlog-task-editor";
import { localStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";

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
        <span className="ml-1.5 font-sans text-xs font-normal text-destructive">
          Conflict
        </span>
      ) : null}
    </Figure>
  );
}

/**
 * The description section. The rendered markdown has a subtle Edit beside its
 * heading that swaps it for the Markdown editor.
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

  const save = (value: string) => {
    const description = value.trim() || undefined;
    if (description !== item.description) {
      patchBacklogItemWithUndo(item, { description }, "Description changed");
    }
  };
  return (
    <>
      <SectionHeading
        trailing={
          !editing && !readOnly ? (
            <button
              type="button"
              className="backlog-item-subtle-action"
              onPointerEnter={preloadMarkdownEditor}
              onFocus={preloadMarkdownEditor}
              onClick={() => {
                closer.reset();
                setEditing(true);
              }}
            >
              Edit
            </button>
          ) : undefined
        }
      >
        Description
      </SectionHeading>
      {editing ? (
        <MarkdownEditor
          autoFocus
          aria-label="Description"
          defaultValue={item.description ?? ""}
          placeholder="Markdown supported"
          minLines={4}
          onBlur={(value) => closer.close(() => save(value))}
          onSubmit={(value) => closer.close(() => save(value))}
          onCancel={() => closer.close()}
        />
      ) : item.description ? (
        <Markdown>{item.description}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
    </>
  );
}

/**
 * "Add subitem" under the subitem list. It opens a name field that creates a
 * subitem with the parent's project and task on Enter, then stays open for
 * the next one. Escape, or leaving it empty, closes it.
 */
export function AddSubitemRow({
  parent,
  adding,
  onAddingChange,
}: {
  parent: LocalWorkItem;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
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

  if (!adding) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 w-fit text-muted-foreground"
        onClick={() => onAddingChange(true)}
      >
        <AddIcon data-icon="inline-start" />
        Add subitem
      </Button>
    );
  }

  return (
    <Input
      autoFocus
      aria-label="New subitem name"
      placeholder="Subitem name, Enter to add"
      value={title}
      className="mt-1"
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => {
        if (!title.trim()) onAddingChange(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          create();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setTitle("");
          onAddingChange(false);
        }
      }}
    />
  );
}
