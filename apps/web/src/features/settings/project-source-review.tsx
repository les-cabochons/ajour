import { useSyncExternalStore } from "react";
import { AppPanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { showErrorToast, showToast } from "@/components/ui/toast";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import {
  findHeldSourceMatch,
  type HeldSourceProjectChoice,
} from "@/domain/projects/source-sync";
import { askAndReportSourceWaitingQuestions } from "@/features/projects/source-waiting-tasks";
import { SettingsLink } from "@/features/settings/settings-link";
import { localStore } from "@/lib/local-store";

/*
 * Source projects held for review (#505): a project source brought a project
 * whose only match here is a local project's name. The user links them, so
 * the local project's time stays where it is, or adds the source project as
 * a project of its own. Nothing is linked by name without asking.
 */

const linkClass = "text-primary underline-offset-2 hover:underline";

function useProjectSourceState() {
  const projectSources = useSyncExternalStore(
    localStore.subscribe,
    () => localStore.snapshot().projectSources,
    () => localStore.snapshot().projectSources,
  );
  const projects = useSyncExternalStore(
    localStore.subscribe,
    () => localStore.snapshot().projects,
    () => localStore.snapshot().projects,
  );
  return { projectSources: projectSources ?? {}, projects };
}

/** The connection row's line for its held projects, linking to Sync review. */
export function HeldSourceProjectsLine({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="text-xs text-[var(--text-tertiary)]">
      {count === 1
        ? "1 project waits for you: it has the name of one of yours. "
        : `${count} projects wait for you: they have the names of yours. `}
      <SettingsLink page="sync-review" className={linkClass}>
        Review in Sync review
      </SettingsLink>
    </p>
  );
}

/** Sync review's section of held source projects, by connection. */
export function HeldSourceProjectsReview() {
  const { projectSources, projects } = useProjectSourceState();
  const groups = Object.entries(projectSources).filter(
    ([, record]) => record.held.length > 0,
  );
  if (groups.length === 0) return null;
  const count = groups.reduce((sum, [, record]) => sum + record.held.length, 0);

  // The answer applies at once, and the row leaves with it: nothing to wait for.
  const resolve = (
    connectionId: string,
    record: { pluginId: string; label: string },
    remoteId: string,
    name: string,
    choice: HeldSourceProjectChoice,
  ) => {
    const result = localStore.resolveHeldSourceProject(
      { pluginId: record.pluginId, connectionId },
      remoteId,
      choice,
    );
    if (result.kind === "linked") {
      showToast(`${name} linked`);
      // The link added the source's tasks: the #481 question, as after a sync.
      if (result.waitingQuestion) {
        void askAndReportSourceWaitingQuestions(record.label, [
          result.waitingQuestion,
        ]);
      }
    } else if (result.kind === "added") showToast(`${name} added`);
    else
      showErrorToast({
        title: `Can't link ${name}`,
        description:
          result.kind === "notLinkable"
            ? "That project is shared with a team or managed already. Add this one as new instead."
            : "It no longer waits: a sync or another window took it.",
      });
  };

  return (
    <AppPanel as="section" aria-label="Projects to link">
      <h3 className="settings-subsection-title">
        {count === 1 ? "1 project to link" : `${count} projects to link`}
      </h3>
      <p className="text-xs text-muted-foreground">
        A project source brought a project with the name of one of yours. Link
        them to keep your time on it, or add it as a new project.
      </p>
      {groups.map(([connectionId, record]) => (
        <section
          key={connectionId}
          aria-label={`Projects from ${record.label}`}
          className="flex flex-col gap-3 rounded-md p-2"
        >
          <span className="text-sm font-medium text-foreground">
            From {record.label}
          </span>
          {record.held.map((held) => {
            const match = findHeldSourceMatch(projects, held);
            return (
              <div
                key={held.remoteId}
                data-held-source-project={held.remoteId}
                className="flex flex-col gap-2 desktop:flex-row desktop:items-start desktop:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium break-words text-foreground">
                    {held.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[held.code, held.client].filter(Boolean).join(" · ")}
                    {match
                      ? ` · Same name as your ${getLocalProjectDisplayName(match)}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    aria-label={
                      match
                        ? `Link ${held.name} to ${getLocalProjectDisplayName(match)}`
                        : `Link ${held.name}`
                    }
                    disabled={!match}
                    onClick={() =>
                      match &&
                      resolve(connectionId, record, held.remoteId, held.name, {
                        kind: "link",
                        projectId: match._id,
                      })
                    }
                  >
                    Link
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`Add as new: ${held.name}`}
                    onClick={() =>
                      resolve(connectionId, record, held.remoteId, held.name, {
                        kind: "addAsNew",
                      })
                    }
                  >
                    Add as new
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </AppPanel>
  );
}
