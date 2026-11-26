import { useEffect, useState } from "react";
import {
  repositoryName,
  type DeckClone,
  type DeckCloneSource,
  type DeckCloneSuggestion,
} from "@ajour/shared/deck";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AppApiError,
  chooseDeckCloneFolder,
  getDeckCloneSuggestions,
} from "@/lib/app-api";

/*
 * Choosing the local clone of a pull request's repository (#795), once per
 * repository. The dialog lists the repository folders Ajour already knows
 * whose remotes name it; the desktop's folder dialog picks any other. Ajour
 * never looks for clones on the disk. The local API keeps a folder only once
 * git says it is a clone of the repository.
 */

/** The repository whose clone is chosen, and where the pull request says it's cloned from. */
export interface DeckCloneTarget {
  pluginId: string;
  connectionId: string;
  repository: string;
  clone: DeckCloneSource;
}

type Props = {
  target: DeckCloneTarget | undefined;
  onOpenChange: (open: boolean) => void;
  /** The clone the user chose. */
  onChosen: (clone: DeckClone) => void;
};

export function DeckClonePicker(props: Props) {
  return (
    <Dialog open={props.target !== undefined} onOpenChange={props.onOpenChange}>
      {props.target ? (
        <PickerContent
          key={`${props.target.connectionId}:${props.target.repository}`}
          {...props}
          target={props.target}
        />
      ) : null}
    </Dialog>
  );
}

const messageOf = (error: unknown) =>
  error instanceof AppApiError &&
  typeof (error.payload as { error?: unknown } | undefined)?.error === "string"
    ? (error.payload as { error: string }).error
    : error instanceof Error
      ? error.message
      : "Ajour couldn't choose that folder.";

function PickerContent({
  target,
  onOpenChange,
  onChosen,
}: Props & { target: DeckCloneTarget }) {
  const [suggestions, setSuggestions] = useState<DeckCloneSuggestion[]>();
  const [current, setCurrent] = useState<DeckClone>();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const chooseFolder = window.ajourDesktop?.chooseDeckClone;

  useEffect(() => {
    let live = true;
    getDeckCloneSuggestions(
      target.pluginId,
      target.connectionId,
      target.repository,
      target.clone,
    ).then(
      (found) => {
        if (!live) return;
        setSuggestions(found.suggestions);
        setCurrent(found.clone);
        setSelected(found.suggestions[0]?.folderId ?? "");
      },
      (failure: unknown) => {
        if (!live) return;
        setSuggestions([]);
        setError(messageOf(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [target]);

  const chosen = (clone: DeckClone) => {
    onChosen(clone);
    onOpenChange(false);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };
  const name = repositoryName(target.repository);

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Your clone of {name}</DialogTitle>
        <DialogDescription>
          Answers can then read the whole codebase at the pull request's head.
          Ajour fetches the pull request into your clone with your own Git
          sign-in, and never changes your branches or files.
        </DialogDescription>
      </DialogHeader>
      {current ? (
        <p className="text-sm text-muted-foreground">
          Now: <span className="break-all">{current.path}</span>
        </p>
      ) : null}
      {suggestions === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          Looking at the folders Ajour knows…
        </p>
      ) : suggestions.length ? (
        <fieldset
          aria-label="Clones Ajour knows"
          className="max-h-80 overflow-y-auto"
        >
          {suggestions.map((folder) => (
            <label
              key={folder.folderId}
              className="flex min-h-10 items-center gap-3 border-b py-2"
            >
              <input
                type="radio"
                name="deck-clone"
                value={folder.folderId}
                checked={selected === folder.folderId}
                onChange={() => setSelected(folder.folderId)}
                aria-label={`${folder.name} ${folder.path}`}
                disabled={busy}
                className="accent-primary focus-visible:outline-2 focus-visible:outline-ring"
              />
              <span className="min-w-0">
                <span className="block text-sm">{folder.name}</span>
                <span className="block text-xs break-all text-muted-foreground">
                  {folder.path}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-muted-foreground">
          {chooseFolder
            ? `No folder Ajour knows is a clone of ${name}. Choose yours.`
            : `No folder Ajour knows is a clone of ${name}. Add yours as a project's repository folder in the desktop app.`}
        </p>
      )}
      {chooseFolder ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const answer = await chooseFolder(target);
              if (!answer) return;
              if ("refused" in answer) {
                setError(answer.refused);
                return;
              }
              chosen(answer.clone);
            })
          }
        >
          Choose a folder…
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          disabled={!selected || busy}
          onClick={() =>
            void run(async () => {
              const { clone } = await chooseDeckCloneFolder(
                target.pluginId,
                target.connectionId,
                target.repository,
                target.clone,
                selected,
              );
              chosen(clone);
            })
          }
        >
          Use clone
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
