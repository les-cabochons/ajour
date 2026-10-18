import { syncBacklogConnection } from "@/lib/app-api";
import type { LocalWorkItem } from "@/domain/local-state";

export function syncBacklogWorkItemToSource(workItem: LocalWorkItem) {
  if (workItem.source === "manual" || !workItem.sourceConnectionId) {
    return;
  }

  void syncBacklogConnection(workItem.source, workItem.sourceConnectionId, {
    trigger: "source_write",
  }).catch((error) => {
    console.error("Backlog work item sync failed.", error);
  });
}
