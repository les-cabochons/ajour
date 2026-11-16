import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import {
  useRepositoryFolders,
  removeRepositoryFolder,
} from "@/lib/repository-folders";

export function RepositoryFoldersSection({ projectId }: { projectId: string }) {
  return <RepositoryFolders key={projectId} projectId={projectId} />;
}

function RepositoryFolders({ projectId }: { projectId: string }) {
  const state = useRepositoryFolders(projectId);
  return (
    <section aria-label="Repositories">
      <SectionHeading>Repositories</SectionHeading>
      <p className="mb-2 text-xs text-muted-foreground">On this computer</p>
      {!state.desktop ? (
        <p className="text-sm text-muted-foreground">
          Folders need the desktop app.
        </p>
      ) : (
        <>
          {state.folders.map((folder) => (
            <div
              key={folder.id}
              className="flex min-h-10 items-center gap-3 border-b py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{folder.name}</p>
                <p className="text-xs break-all text-muted-foreground">
                  {folder.path}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={state.busy}
                aria-label={`Remove ${folder.name}`}
                onClick={() =>
                  void state.run(async () =>
                    state.setFolders(
                      await removeRepositoryFolder(projectId, folder.id),
                    ),
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={state.busy}
            onClick={() => void state.add()}
          >
            Add folder…
          </Button>
          {state.busy ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading folders…
            </p>
          ) : null}
        </>
      )}
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
