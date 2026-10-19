import { useId, useState, type MouseEvent } from "react";
import { Markdown } from "@/components/markdown";
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
import { localStore } from "@/lib/local-store";
import { openSourceUrl } from "@/lib/source-navigation";

/*
 * Links in a backlog item's description, in its text and its frontmatter,
 * come from whoever wrote it, often in the source tool. While the
 * "Ask before opening description links" preference is on, they show their
 * full address and ask before they open (#281).
 */

/**
 * Asks before a description link opens. `ask` goes on the link's click and
 * middle click; render `dialog` once beside the links.
 */
export function useLinkQuestion() {
  const [url, setUrl] = useState<string | null>(null);

  function ask(event: MouseEvent, href: string) {
    // A right click opens the context menu, not the link.
    if (event.type === "auxclick" && event.button !== 1) return;
    const asking =
      localStore.snapshot().userPreferences.askBeforeOpeningDescriptionLinks !==
      false;
    if (!asking) return;
    event.preventDefault();
    setUrl(href);
  }

  return {
    ask,
    dialog: <OpenLinkDialog url={url} onClose={() => setUrl(null)} />,
  };
}

/** A description's text, whose links ask before they open. */
export function DescriptionText({ body }: { body: string }) {
  const { ask, dialog } = useLinkQuestion();

  // One listener for every web link the markdown renders; mail links open
  // the mail app as before.
  function onLinkClick(event: MouseEvent<HTMLDivElement>) {
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    if (
      link &&
      event.currentTarget.contains(link) &&
      /^https?:$/.test(link.protocol)
    ) {
      ask(event, link.href);
    }
  }

  return (
    <div onClick={onLinkClick} onAuxClick={onLinkClick}>
      <Markdown>{body}</Markdown>
      {dialog}
    </div>
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
                  askBeforeOpeningDescriptionLinks: false,
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
