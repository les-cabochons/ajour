import { useEffect, useId, useMemo, useState } from "react";
import { RiAddLine as Plus, RiCloseLine as X } from "@remixicon/react";
import type {
  BacklogItemTypesRequest,
  BacklogItemTypesResult,
  PluginField,
  PluginFieldValue,
} from "@ajour/shared";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import { Value } from "@/components/ui/value";
import type { SourceItemTypeCount } from "@/domain/backlog/source-item-types";
import {
  describedType,
  draftsOfValue,
  itemTypesRequest,
  missingField,
  otherItemTypes,
  sameName,
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

/** The plugin's answer about the types, once per opening of the form. */
type ItemTypesLookup =
  | { status: "none" }
  | { status: "loading" }
  | { status: "loaded"; result: BacklogItemTypesResult }
  | { status: "failed" };

/**
 * A plugin icon as an image, never as markup: the rule for every SVG a
 * plugin sends. Decorative, since the row's legend names the type.
 */
function TypeIcon({ svg }: { svg: string }) {
  return (
    <img
      alt=""
      width={14}
      height={14}
      className="connection-type-icon"
      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
    />
  );
}

/**
 * A `typeOverrides` field in the connection form: one row per item type,
 * with one chip per field the type can replace, and Add a type. The rows are
 * the types found in the connection's items, then the types the value names.
 * The block keeps what the user types, and writes the value, trimmed, to
 * the form on each change. Mount it once per opening of the form.
 *
 * With `describe`, the block asks the plugin once, on mount, about the
 * types: each row then shows the type's icon, its chips suggest the type's
 * fields, and a chip left empty on a type that lacks the connection's field
 * says so under the row, with the plugin's proposal dashed in the chip and
 * Use it to fill it. Add a type offers the plugin's other types. When the
 * call fails, the block works as without it, and says so once.
 */
export function TypeOverridesField({
  field,
  columns,
  found,
  value,
  connectionValues,
  pluginName,
  describe,
  onChange,
}: {
  field: PluginField;
  columns: ReadonlyArray<{ field: PluginField; label: string }>;
  /** The item types of the connection's synced items, most first. */
  found: readonly SourceItemTypeCount[];
  value: PluginFieldValue | undefined;
  /** The connection's own text for each replaced field, by field id, as the form holds it. */
  connectionValues: Readonly<Record<string, string>>;
  /** The plugin's name, for the line that says its lookup failed. */
  pluginName: string;
  /** Asks the plugin about the types; absent when it can't be asked. */
  describe?: (
    request: BacklogItemTypesRequest,
  ) => Promise<BacklogItemTypesResult>;
  onChange: (value: string) => void;
}) {
  const idPrefix = useId();
  const [drafts, setDrafts] = useState(() => draftsOfValue(value));
  const [lookup, setLookup] = useState<ItemTypesLookup>(() =>
    describe ? { status: "loading" } : { status: "none" },
  );
  const rows = useMemo(() => typeOverrideRows(found, drafts), [found, drafts]);
  const described = lookup.status === "loaded" ? lookup.result : undefined;

  // Once per mount, so once per opening of the form, with the types it
  // opened with: the deps stay empty on purpose.
  useEffect(() => {
    if (!describe) return;
    let current = true;
    describe(itemTypesRequest(found, draftsOfValue(value))).then(
      (result) => {
        if (current) setLookup({ status: "loaded", result });
      },
      () => {
        if (current) setLookup({ status: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const update = (next: TypeOverrideDraft[]) => {
    setDrafts(next);
    onChange(valueOfDrafts(next));
  };
  const addType = (name: string) => update(withDraftAdded(drafts, name));

  // Names line up while the answer is on its way, and when any type has an icon.
  const iconSlot =
    lookup.status === "loading" ||
    Boolean(described?.types.some((type) => type.iconSvg));
  const addOptions = useMemo<SearchableSelectOption[]>(
    () =>
      otherItemTypes(described, rows).map((type) => ({
        value: type.name,
        label: type.name,
        icon: type.iconSvg ? <TypeIcon svg={type.iconSvg} /> : undefined,
      })),
    [described, rows],
  );

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
      {lookup.status === "failed" ? (
        <p className="text-xs text-muted-foreground">
          Couldn't read the item types from {pluginName}, so the rows show no
          icons or proposals.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          The types show here after the first sync.
        </p>
      ) : null}
      {rows.map((row, rowIndex) => {
        const type = describedType(described, row.name);
        const fieldNames = [
          ...new Set(type?.fields?.map((typeField) => typeField.name)),
        ];
        const listId = `${idPrefix}-${rowIndex}-fields`;
        const chips = columns.map((column) => ({
          column,
          missing: missingField(
            type,
            column.field.id,
            connectionValues[column.field.id] ?? "",
            row.values[column.field.id] ?? "",
          ),
        }));
        return (
          <fieldset key={row.name.toLowerCase()} className="connection-row">
            <legend className="sr-only">
              {row.count !== undefined
                ? `${row.name}, ${itemCount(row.count)}`
                : row.name}
            </legend>
            <div
              className="connection-row-label"
              data-icon-slot={iconSlot ? "true" : undefined}
            >
              <span className="connection-type-name">
                {type?.iconSvg ? (
                  <TypeIcon svg={type.iconSvg} />
                ) : iconSlot ? (
                  <span aria-hidden className="connection-type-icon" />
                ) : null}
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
                {chips.map(({ column, missing }) => {
                  const id = `${idPrefix}-${rowIndex}-${column.field.id}`;
                  return (
                    <div
                      key={column.field.id}
                      className="composer-chip composer-estimate"
                      data-proposed={missing?.proposal ? "true" : undefined}
                      data-missing={missing ? "true" : undefined}
                    >
                      <label htmlFor={id}>{column.label}</label>
                      <input
                        id={id}
                        className="composer-estimate-input type-override-input"
                        autoComplete="off"
                        list={fieldNames.length ? listId : undefined}
                        placeholder={
                          missing
                            ? (missing.proposal ?? "none on this type")
                            : "same"
                        }
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
              {fieldNames.length ? (
                <datalist id={listId}>
                  {fieldNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              ) : null}
              {chips.map(({ column, missing }) => {
                if (!missing) return null;
                const hintId = `${idPrefix}-${rowIndex}-${column.field.id}-hint`;
                return (
                  <p
                    key={column.field.id}
                    className="text-xs text-muted-foreground"
                  >
                    <span id={hintId}>
                      {row.name} has no {missing.field} field.
                    </span>
                    {missing.proposal ? (
                      <>
                        {" "}
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-xs"
                          aria-describedby={hintId}
                          onClick={() =>
                            update(
                              withDraftText(
                                drafts,
                                row.name,
                                column.field.id,
                                missing.proposal!,
                              ),
                            )
                          }
                        >
                          Use it
                        </Button>
                      </>
                    ) : null}
                  </p>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      {/* A chip, as the rows' are: it picks one of the plugin's other types or takes a name. */}
      <div className="composer-chips">
        <SearchableSelect
          value=""
          options={addOptions}
          onChange={(name) => {
            if (name) addType(name);
          }}
          placeholder="Add a type"
          placeholderIcon={<Plus />}
          popoverMinWidth={240}
          ariaLabel="Add a type"
          emptyMessage="Type its name as the source spells it"
          create={{
            // Nothing to add when a row or an option already has the name.
            label: (text) =>
              rows.some((row) => sameName(row.name, text)) ||
              addOptions.some((option) => sameName(option.label, text))
                ? null
                : `Add "${text}"`,
            onCreate: addType,
          }}
        />
      </div>
    </section>
  );
}
