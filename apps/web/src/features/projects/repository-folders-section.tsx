import { useCallback, useEffect, useId, useState } from "react";
import type { ListedWorktree, ProjectStartIn } from "@ajour/shared/worktrees";
import { SettingRow } from "@/components/app-surface";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { OptionSelect } from "@/components/ui/option-select";
import {
  projectStartInChoices,
  type ProjectStartInChoice,
} from "@/domain/handoffs/start-in";
import {
  describeListedWorktree,
  describeWorktreeItem,
} from "@/domain/handoffs/worktrees";
import { WorktreeRow } from "@/features/worktrees/worktree-row";
import {
  getProjectStartIn,
  listWorktreeStatuses,
  saveProjectStartIn,
} from "@/lib/app-api";
import { useLocalWorkItems } from "@/lib/local-hooks";
import { onDefaultStartInChange } from "@/lib/worktrees";
import {
  useRepositoryFolders,
  removeRepositoryFolder,
} from "@/lib/repository-folders";

export function RepositoryFoldersSection({ projectId }: { projectId: string }) {
  return <RepositoryFolders key={projectId} projectId={projectId} />;
}

/**
 * "Hand offs start in" (#864): the project's own Start in, over the
 * default of Settings › Worktrees, for this computer. The local API keeps
 * it, so the row shows what the API answers. A pick is saved at once, and
 * a save the API refuses leaves the saved choice selected and says so
 * where the description was, so the row keeps its height.
 */
function ProjectStartInRow({ projectId }: { projectId: string }) {
  const selectId = useId();
  const [startIn, setStartIn] = useState<ProjectStartIn>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    getProjectStartIn(projectId).then(
      (answer) => {
        if (current) setStartIn(answer);
      },
      () => {
        if (current) setError("Couldn't read where hand offs start.");
      },
    );
    // The default can change in the Settings window while this page stays
    // open under it: "Settings (<default>)" then names the new one.
    const stop = onDefaultStartInChange((settings) =>
      setStartIn((shown) => (shown ? { ...shown, settings } : shown)),
    );
    return () => {
      current = false;
      stop();
    };
  }, [projectId]);

  const save = (choice: ProjectStartInChoice) => {
    setSaving(true);
    setError("");
    saveProjectStartIn(projectId, choice === "settings" ? null : choice)
      .then(setStartIn, () => setError("Couldn't save where hand offs start."))
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Hand offs start in"
      labelFor={selectId}
      description={
        error ? (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        ) : (
          "Overrides Settings › Worktrees for this project."
        )
      }
      className="mb-1"
    >
      <OptionSelect<ProjectStartInChoice>
        id={selectId}
        className="w-56"
        // Until the API answers, no choice shows as the saved one.
        disabled={saving || !startIn}
        value={startIn ? (startIn.override ?? "settings") : "settings"}
        onChange={save}
        options={
          startIn
            ? projectStartInChoices(startIn.settings)
            : [{ value: "settings", label: "Settings" }]
        }
      />
    </SettingRow>
  );
}

function RepositoryFolders({ projectId }: { projectId: string }) {
  const state = useRepositoryFolders(projectId);
  const items = useLocalWorkItems();
  // The project's worktrees with their status, read from git by the local
  // API each time the section opens and after a delete or a forget.
  const [worktrees, setWorktrees] = useState<ListedWorktree[]>([]);
  const { desktop } = state;
  const loadWorktrees = useCallback(() => {
    if (!desktop) return;
    void listWorktreeStatuses({ projectId }).then(setWorktrees, () =>
      // A list that can't be read shows none: the folders stay usable.
      setWorktrees([]),
    );
  }, [desktop, projectId]);
  useEffect(loadWorktrees, [loadWorktrees]);

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
          <ProjectStartInRow projectId={projectId} />
          {state.folders.map((folder) => {
            const inFolder = worktrees.filter(
              (listed) => listed.worktree.repositoryFolderId === folder.id,
            );
            return (
              <div key={folder.id}>
                <div className="flex min-h-10 items-center gap-3 border-b py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{folder.name}</p>
                    <p className="text-xs break-all text-muted-foreground">
                      {folder.path}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    disabled={state.busy}
                    aria-label={`Remove ${folder.name}`}
                    onClick={() =>
                      void state.run(async () => {
                        state.setFolders(
                          await removeRepositoryFolder(projectId, folder.id),
                        );
                        // Its worktrees leave Ajour's list with it.
                        loadWorktrees();
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
                {inFolder.length ? (
                  <ul
                    className="ml-4"
                    aria-label={`Worktrees in ${folder.name}`}
                  >
                    {inFolder.map((listed) => (
                      <WorktreeRow
                        key={listed.worktree.id}
                        listed={listed}
                        title={describeWorktreeItem(listed.worktree, items)}
                        status={describeListedWorktree(listed)}
                        onChanged={loadWorktrees}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          <Button
            variant="outline"
            className="mt-2"
            disabled={state.busy}
            onClick={() => void state.add()}
          >
            Add folder…
          </Button>
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
