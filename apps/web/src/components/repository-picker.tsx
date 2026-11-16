import { repositoryFolderSelection } from "@/domain/projects/repository-folders";
import { useEffect, useState } from "react";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useRepositoryFolders,
  useRepositoryFolder,
} from "@/lib/repository-folders";

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (folder: RepositoryFolder) => void;
};

/** The hand-off workflow supplies the host dialog's open state and selection callback. */
export function RepositoryPicker(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <PickerContent key={props.projectId} {...props} /> : null}
    </Dialog>
  );
}

function PickerContent({ projectId, onOpenChange, onSelect }: Props) {
  const state = useRepositoryFolders(projectId);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected((current) => repositoryFolderSelection(state.folders, current));
  }, [state.folders]);
  const folder = state.folders.find((folder) => folder.id === selected);
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Choose repository folder</DialogTitle>
        <DialogDescription>On this computer</DialogDescription>
      </DialogHeader>
      {!state.desktop ? (
        <p>Folders need the desktop app.</p>
      ) : (
        <>
          {!state.busy && !state.folders.length ? (
            <p className="text-sm text-muted-foreground">
              Add a folder for this project.
            </p>
          ) : null}
          <fieldset
            aria-label="Repository folders"
            className="max-h-80 overflow-y-auto"
          >
            {state.folders.map((folder) => (
              <label
                key={folder.id}
                className="flex min-h-10 items-center gap-3 border-b py-2"
              >
                <input
                  type="radio"
                  name="repository-folder"
                  value={folder.id}
                  checked={selected === folder.id}
                  onChange={() => setSelected(folder.id)}
                  aria-label={`${folder.name} ${folder.path}`}
                  disabled={state.busy}
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
          <Button
            variant="outline"
            disabled={state.busy}
            onClick={() => void state.add()}
          >
            Add folder…
          </Button>
        </>
      )}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          variant="ghost"
          disabled={state.busy}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          disabled={!folder || state.busy}
          onClick={() =>
            void state.run(async () => {
              if (!folder) return;
              await useRepositoryFolder(projectId, folder.id);
              onSelect(folder);
              onOpenChange(false);
            })
          }
        >
          Use folder
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
