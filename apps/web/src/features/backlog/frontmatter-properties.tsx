import { useId, useMemo, useState, type MouseEvent } from "react";
import {
  RiArrowRightSLine as ChevronIcon,
  RiExternalLinkLine as ExternalIcon,
} from "@remixicon/react";
import { PropertyList, PropertyRow } from "@/components/property-list";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Value } from "@/components/ui/value";
import {
  isFrontmatterLink,
  splitDescription,
  type FrontmatterField,
} from "@/domain/backlog/description-frontmatter";
import { localStore } from "@/lib/local-store";
import { openSourceUrl } from "@/lib/source-navigation";
import { cn } from "@/lib/utils";

/*
 * A description's frontmatter fields in the backlog item's properties
 * (#281): plain values are rows of the property list, and each list or
 * nested key is a section below it that starts closed. A link asks before
 * it opens.
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
  nested = false,
}: {
  fields: FrontmatterField[];
  nested?: boolean;
}) {
  return fields.map((field) =>
    field.kind === "value" ? null : (
      <FrontmatterSection key={field.key} field={field} nested={nested} />
    ),
  );
}

function FrontmatterSection({
  field,
  nested,
}: {
  field: Exclude<FrontmatterField, { kind: "value" }>;
  nested: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
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
        onClick={() => setOpen(!open)}
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
              <FrontmatterSections fields={field.fields} nested />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A value as text, or a link that asks before it opens. */
function FrontmatterValue({ value }: { value: string }) {
  const [asking, setAsking] = useState(false);
  if (!isFrontmatterLink(value)) {
    return <span className="min-w-0 break-words">{value}</span>;
  }

  function open(event: MouseEvent<HTMLAnchorElement>) {
    const ask =
      localStore.snapshot().userPreferences.askBeforeOpeningFrontmatterLinks !==
      false;
    if (!ask) return;
    event.preventDefault();
    setAsking(true);
  }

  return (
    <>
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-w-0 items-center gap-1"
        onClick={open}
        onAuxClick={open}
      >
        <span className="truncate">{value}</span>
        <ExternalIcon className="size-3 shrink-0" />
      </a>
      <OpenLinkDialog
        url={value}
        open={asking}
        onClose={() => setAsking(false)}
      />
    </>
  );
}

/** "Open this link?" with the full address and "Don't ask again". */
function OpenLinkDialog({
  url,
  open,
  onClose,
}: {
  url: string;
  open: boolean;
  onClose: () => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  const checkboxId = useId();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) setDontAsk(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open this link?</AlertDialogTitle>
          <AlertDialogDescription>
            It comes from the description and opens in your browser:
            <span className="mt-1.5 block font-mono text-xs break-all text-foreground">
              {url}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label
          htmlFor={checkboxId}
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Checkbox
            id={checkboxId}
            checked={dontAsk}
            onCheckedChange={(checked) => setDontAsk(checked)}
          />
          Don't ask again
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (dontAsk) {
                localStore.setUserPreferences({
                  askBeforeOpeningFrontmatterLinks: false,
                });
              }
              openSourceUrl(url);
              onClose();
            }}
          >
            Open link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
