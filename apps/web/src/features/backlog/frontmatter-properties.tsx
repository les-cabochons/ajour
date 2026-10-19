import { useMemo, type MouseEvent } from "react";
import { RiExternalLinkLine as ExternalIcon } from "@remixicon/react";
import {
  PropertyList,
  PropertyRow,
  PropertySection,
} from "@/components/property-list";
import { Value } from "@/components/ui/value";
import {
  isFrontmatterLink,
  splitDescription,
  type FrontmatterField,
} from "@/domain/backlog/description-frontmatter";
import {
  getFrontmatterSectionId,
  setFrontmatterSectionOpen,
  useFrontmatterSectionOpen,
} from "@/lib/frontmatter-sections";

/*
 * A description's frontmatter fields in the backlog item's properties
 * (#281): plain values are rows of the property list, and each list or
 * nested key is a section below it, closed until the user opens it. This
 * device remembers which sections are open, by their keys, on every item.
 * Links ask before they open through the card's one `useLinkQuestion`.
 */

/** What a link calls on click and middle click: `useLinkQuestion`'s `ask`. */
type OnLinkClick = (event: MouseEvent, href: string) => void;

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
export function FrontmatterRows({
  fields,
  onLinkClick,
}: {
  fields: FrontmatterField[];
  onLinkClick: OnLinkClick;
}) {
  return fields.map((field) =>
    field.kind === "value" ? (
      <PropertyRow key={field.key} label={field.key}>
        <FrontmatterValue value={field.value} onLinkClick={onLinkClick} />
      </PropertyRow>
    ) : null,
  );
}

/** The lists and nested keys, each a section that starts closed. */
export function FrontmatterSections({
  fields,
  onLinkClick,
  parentPath = [],
}: {
  fields: FrontmatterField[];
  onLinkClick: OnLinkClick;
  /** The keys above these fields, for a section nested in another. */
  parentPath?: readonly string[];
}) {
  return fields.map((field) =>
    field.kind === "value" ? null : (
      <FrontmatterSection
        key={field.key}
        field={field}
        path={[...parentPath, field.key]}
        onLinkClick={onLinkClick}
      />
    ),
  );
}

function FrontmatterSection({
  field,
  path,
  onLinkClick,
}: {
  field: Exclude<FrontmatterField, { kind: "value" }>;
  path: readonly string[];
  onLinkClick: OnLinkClick;
}) {
  const sectionId = getFrontmatterSectionId(path);
  const open = useFrontmatterSectionOpen(sectionId);
  const hasRows =
    field.kind === "map" &&
    field.fields.some((child) => child.kind === "value");
  return (
    <PropertySection
      title={field.key}
      trailing={
        field.kind === "list" ? (
          <Value tone="muted" className="ml-auto">
            {field.values.length}
          </Value>
        ) : undefined
      }
      open={open}
      onOpenChange={(next) => setFrontmatterSectionOpen(sectionId, next)}
      nested={path.length > 1}
      indent
    >
      {field.kind === "list" ? (
        <ul className="flex flex-col">
          {field.values.map((value, index) => (
            <li
              key={index}
              className="flex min-h-7 min-w-0 items-center text-sm"
            >
              <FrontmatterValue value={value} onLinkClick={onLinkClick} />
            </li>
          ))}
        </ul>
      ) : (
        <>
          {hasRows ? (
            <PropertyList>
              <FrontmatterRows
                fields={field.fields}
                onLinkClick={onLinkClick}
              />
            </PropertyList>
          ) : null}
          <FrontmatterSections
            fields={field.fields}
            parentPath={path}
            onLinkClick={onLinkClick}
          />
        </>
      )}
    </PropertySection>
  );
}

/** A value as text, or a link that asks before it opens. */
function FrontmatterValue({
  value,
  onLinkClick,
}: {
  value: string;
  onLinkClick: OnLinkClick;
}) {
  if (!isFrontmatterLink(value)) {
    return <span className="min-w-0 break-words">{value}</span>;
  }
  return (
    <a
      href={value}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1"
      onClick={(event) => onLinkClick(event, value)}
      onAuxClick={(event) => onLinkClick(event, value)}
    >
      <span className="truncate">{value}</span>
      <ExternalIcon className="size-3 shrink-0" />
    </a>
  );
}
