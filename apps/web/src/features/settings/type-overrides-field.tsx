import { useId, useMemo, useState } from "react";
import { RiAddLine as Plus, RiCloseLine as X } from "@remixicon/react";
import type { PluginField, PluginFieldValue } from "@ajour/shared";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Value } from "@/components/ui/value";
import type { SourceItemTypeCount } from "@/domain/backlog/source-item-types";
import {
  draftsOfValue,
  typeOverrideRows,
  valueOfDrafts,
  withDraftAdded,
  withDraftText,
  withoutDraft,
  type TypeOverrideDraft,
} from "./type-overrides-rows";

function itemCount(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

const DEFAULT_HELP =
  "The types in this connection's synced items. A type uses the fields above unless you set another one.";

/**
 * A `typeOverrides` field in the connection form: one row per item type,
 * with one chip per field the type can replace, and Add a type. The rows are
 * the types found in the connection's items, then the types the value names.
 * The block keeps what the user types, and writes the value, trimmed, to
 * the form on each change. Mount it once per opening of the form.
 */
export function TypeOverridesField({
  field,
  columns,
  found,
  value,
  onChange,
}: {
  field: PluginField;
  columns: ReadonlyArray<{ field: PluginField; label: string }>;
  /** The item types of the connection's synced items, most first. */
  found: readonly SourceItemTypeCount[];
  value: PluginFieldValue | undefined;
  onChange: (value: string) => void;
}) {
  const idPrefix = useId();
  const [drafts, setDrafts] = useState(() => draftsOfValue(value));
  const [newType, setNewType] = useState<string | null>(null);
  const rows = useMemo(() => typeOverrideRows(found, drafts), [found, drafts]);

  const update = (next: TypeOverrideDraft[]) => {
    setDrafts(next);
    onChange(valueOfDrafts(next));
  };
  const finishAdding = (name: string) => {
    if (name.trim()) update(withDraftAdded(drafts, name));
    setNewType(null);
  };

  return (
    <section
      aria-labelledby={`${idPrefix}-title`}
      className="connection-type-overrides"
    >
      <h5 id={`${idPrefix}-title`} className="connection-type-overrides-title">
        {field.label}
      </h5>
      <p className="text-xs text-muted-foreground">
        {field.helpText ?? DEFAULT_HELP}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          The types show here after the first sync.
        </p>
      ) : null}
      {rows.map((row, rowIndex) => (
        <fieldset key={row.name.toLowerCase()} className="connection-row">
          <legend className="sr-only">
            {row.count !== undefined
              ? `${row.name}, ${itemCount(row.count)}`
              : row.name}
          </legend>
          <div className="connection-row-label">
            <span className="connection-type-name">
              <span aria-hidden>{row.name}</span>
              {row.removable ? (
                <TooltipButton
                  label={`Remove ${row.name}`}
                  render={
                    <Button type="button" variant="ghost" size="icon-xs" />
                  }
                  onClick={() => update(withoutDraft(drafts, row.name))}
                >
                  <X />
                </TooltipButton>
              ) : null}
            </span>
            {row.count !== undefined ? (
              <span aria-hidden className="connection-row-count">
                <Value tone="muted">{row.count}</Value>{" "}
                {row.count === 1 ? "item" : "items"}
              </span>
            ) : null}
          </div>
          <div className="connection-row-value">
            <div className="composer-chips">
              {columns.map((column) => {
                const id = `${idPrefix}-${rowIndex}-${column.field.id}`;
                return (
                  <div
                    key={column.field.id}
                    className="composer-chip composer-estimate"
                  >
                    <label htmlFor={id}>{column.label}</label>
                    <input
                      id={id}
                      className="composer-estimate-input type-override-input"
                      autoComplete="off"
                      placeholder="same"
                      value={row.values[column.field.id] ?? ""}
                      onChange={(event) =>
                        update(
                          withDraftText(
                            drafts,
                            row.name,
                            column.field.id,
                            event.target.value,
                          ),
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </fieldset>
      ))}
      {newType === null ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setNewType("")}
          >
            <Plus data-icon="inline-start" />
            Add a type
          </Button>
        </div>
      ) : (
        <Input
          autoFocus
          aria-label="New type name"
          placeholder="Name it as the source does"
          className="max-w-xs"
          value={newType}
          onChange={(event) => setNewType(event.target.value)}
          onBlur={() => finishAdding(newType)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishAdding(newType);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setNewType(null);
            }
          }}
        />
      )}
    </section>
  );
}
