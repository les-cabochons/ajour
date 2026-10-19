import { useId, useMemo } from "react";
import {
  RiArrowRightSLine as ChevronIcon,
  RiExternalLinkLine as ExternalIcon,
} from "@remixicon/react";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { Value } from "@/components/ui/value";
import {
  isFrontmatterLink,
  splitDescription,
  type FrontmatterField,
} from "@/domain/backlog/description-frontmatter";
import { useLinkQuestion } from "@/features/backlog/description-links";
import {
  getFrontmatterSectionId,
  setFrontmatterSectionOpen,
  useFrontmatterSectionOpen,
} from "@/lib/frontmatter-sections";
import { cn } from "@/lib/utils";

/*
 * A description's frontmatter fields in the backlog item's properties
 * (#281): plain values are rows of the property list, and each list or
 * nested key is a section below it, closed until the user opens it. This
 * device remembers which sections are open, by their keys, on every item.
 * A link asks before it opens.
 */

/** The frontmatter fields of a description, without its timelog. */
export function useFrontmatterFields(description: string | undefined) {
  return useMemo(
    () =>
      description
        ? (splitDescription(description).frontmatter?.fields ?? [])
        : [],
    [description],
  );
}

/** The plain values, as rows inside a `PropertyList`. */
export function FrontmatterRows({ fields }: { fields: FrontmatterField[] }) {
  return fields.map((field) =>
    field.kind === "value" ? (
      <PropertyRow key={field.key} label={field.key}>
        <FrontmatterValue value={field.value} />
      </PropertyRow>
    ) : null,
  );
}

/** The lists and nested keys, each a section that starts closed. */
export function FrontmatterSections({
  fields,
  parentPath = [],
}: {
  fields: FrontmatterField[];
  /** The keys above these fields, for a section nested in another. */
  parentPath?: readonly string[];
}) {
  return fields.map((field) =>
    field.kind === "value" ? null : (
      <FrontmatterSection
        key={field.key}
        field={field}
        path={[...parentPath, field.key]}
      />
    ),
  );
}

function FrontmatterSection({
  field,
  path,
}: {
  field: Exclude<FrontmatterField, { kind: "value" }>;
  path: readonly string[];
}) {
  const sectionId = getFrontmatterSectionId(path);
  const open = useFrontmatterSectionOpen(sectionId);
  const contentId = useId();
  const nested = path.length > 1;
  const hasRows =
    field.kind === "map" &&
    field.fields.some((child) => child.kind === "value");
  return (
    <div className={cn("flex flex-col gap-2.5", !nested && "border-t pt-3")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-w-0 items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setFrontmatterSectionOpen(sectionId, !open)}
      >
        <ChevronIcon
          aria-hidden="true"
          className={cn("size-4 shrink-0", open && "rotate-90")}
        />
        <span className="truncate">{field.key}</span>
        {field.kind === "list" ? (
          <Value tone="muted" className="ml-auto">
            {field.values.length}
          </Value>
        ) : null}
      </button>
      {open ? (
        <div id={contentId} className="flex min-w-0 flex-col gap-2.5 pl-5">
          {field.kind === "list" ? (
            <ul className="flex flex-col">
              {field.values.map((value, index) => (
                <li
                  key={index}
                  className="flex min-h-7 min-w-0 items-center text-sm"
                >
                  <FrontmatterValue value={value} />
                </li>
              ))}
            </ul>
          ) : (
            <>
              {hasRows ? (
                <PropertyList>
                  <FrontmatterRows fields={field.fields} />
                </PropertyList>
              ) : null}
              <FrontmatterSections fields={field.fields} parentPath={path} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A value as text, or a link that asks before it opens. */
function FrontmatterValue({ value }: { value: string }) {
  const { ask, dialog } = useLinkQuestion();
  if (!isFrontmatterLink(value)) {
    return <span className="min-w-0 break-words">{value}</span>;
  }
  return (
    <>
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-w-0 items-center gap-1"
        onClick={(event) => ask(event, value)}
        onAuxClick={(event) => ask(event, value)}
      >
        <span className="truncate">{value}</span>
        <ExternalIcon className="size-3 shrink-0" />
      </a>
      {dialog}
    </>
  );
}
