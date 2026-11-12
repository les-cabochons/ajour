import { useCallback, useEffect, useState } from "react";
import { showErrorToast, showToast } from "@/components/ui/toast";
import type { LocalProject } from "@/domain/local-state";
import { sourceNameOf } from "@/domain/projects/source-link";
import {
  askAndReportSourceWaitingQuestions,
  offerSourceWaitingQuestions,
} from "@/features/projects/source-waiting-tasks";
import {
  describeProjectSourceSync,
  syncOpenedProjectSource,
  syncProjectSourceConnection,
} from "@/lib/project-source-sync";

/*
 * A managed project's page syncs its project source (#686): when it opens,
 * unless the user synced that connection a moment ago, and from Sync now.
 * Both are syncs the user asked for, so a plugin that answers from a cache
 * reads the source.
 */

/**
 * Syncs the source of a managed project when its page opens, and gives Sync
 * now. The sync on open is quiet: a failure shows on the connection in
 * Settings, and new waiting tasks are offered from a toast, as after the
 * 15-minute sync. Sync now says what it did, or why it failed.
 */
export function useProjectSourceSync(
  project: LocalProject,
  sourceLabel: string | undefined,
) {
  const [syncing, setSyncing] = useState(false);
  const pluginId = project.source?.pluginId;
  const connectionId = project.source?.connectionId;

  useEffect(() => {
    if (!pluginId || !connectionId) return;
    syncOpenedProjectSource(pluginId, connectionId)?.then(
      (outcome) => {
        if (outcome.kind === "applied") {
          offerSourceWaitingQuestions(outcome.label, outcome.waitingQuestions);
        }
      },
      // The sync's own event and the connection's error record it.
      () => undefined,
    );
  }, [pluginId, connectionId]);

  const syncNow = useCallback(() => {
    if (!pluginId || !connectionId) return;
    const name = sourceNameOf(sourceLabel, true);
    setSyncing(true);
    syncProjectSourceConnection(pluginId, connectionId, { trigger: "user" })
      .then(
        (outcome) => {
          showToast(describeProjectSourceSync(name, outcome));
          if (outcome.kind === "applied") {
            void askAndReportSourceWaitingQuestions(
              outcome.label,
              outcome.waitingQuestions,
            );
          }
        },
        (error: unknown) =>
          showErrorToast({
            title: `${name} sync failed`,
            description:
              error instanceof Error ? error.message : "Unknown error",
          }),
      )
      .finally(() => setSyncing(false));
  }, [pluginId, connectionId, sourceLabel]);

  return { syncing, syncNow };
}
