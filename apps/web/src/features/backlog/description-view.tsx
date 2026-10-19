import { useId, useMemo, useState, type MouseEvent } from "react";
import { RiExternalLinkLine as ExternalIcon } from "@remixicon/react";
import { Markdown } from "@/components/markdown";
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
import {
  isFrontmatterLink,
  splitDescription,
  type FrontmatterField,
} from "@/domain/backlog/description-frontmatter";
import { localStore } from "@/lib/local-store";
import { openSourceUrl } from "@/lib/source-navigation";

/**
 * A backlog item's description as the item page and the peek show it: the
 * frontmatter's fields, then the text without the block (#281). Edit shows
 * the whole text.
 */
export function DescriptionView({ description }: { description: string }) {
  const { frontmatter, body } = useMemo(
    () => splitDescription(description),
    [description],
  );
  const fields = frontmatter?.fields ?? [];
  return (
    <>
      {fields.length > 0 ? <FrontmatterFields fields={fields} /> : null}
      {body ? <Markdown>{body}</Markdown> : null}
    </>
  );
}

/**
 * The frontmatter's fields, labelled with their keys. A link asks before it
 * opens, unless the user turned the question off.
 */
function FrontmatterFields({ fields }: { fields: FrontmatterField[] }) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  function openLink(event: MouseEvent<HTMLAnchorElement>, url: string) {
    const ask =
      localStore.snapshot().userPreferences.askBeforeOpeningFrontmatterLinks !==
      false;
    if (!ask) return;
    event.preventDefault();
    setPendingUrl(url);
  }

  return (
    <>
      <PropertyList className="mb-3" aria-label="Frontmatter">
        {fields.map((field) => (
          <PropertyRow key={field.key} label={field.key}>
            <span className="flex min-w-0 flex-wrap items-center gap-x-3">
              {field.values.map((value, index) =>
                isFrontmatterLink(value) ? (
                  <a
                    key={index}
                    href={value}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1"
                    onClick={(event) => openLink(event, value)}
                    onAuxClick={(event) => openLink(event, value)}
                  >
                    <span className="truncate">{value}</span>
                    <ExternalIcon className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span key={index} className="min-w-0 break-words">
                    {value}
                  </span>
                ),
              )}
            </span>
          </PropertyRow>
        ))}
      </PropertyList>
      <OpenLinkDialog url={pendingUrl} onClose={() => setPendingUrl(null)} />
    </>
  );
}

/** "Open this link?" with the full address and "Don't ask again". */
function OpenLinkDialog({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  const checkboxId = useId();

  return (
    <AlertDialog
      open={url !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setDontAsk(false);
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
              if (url) openSourceUrl(url);
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
