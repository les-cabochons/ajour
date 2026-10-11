import { useCallback, useSyncExternalStore } from "react";
import type { ActivityBlockRecord } from "@ajour/shared";
import type { ImportedBrowserDraft } from "@/domain/local-state";
import { localStore } from "@/lib/local-store";

export function useLocalState() {
  return useSyncExternalStore(
    localStore.subscribe,
    localStore.snapshot,
    localStore.snapshot,
  );
}

export function useLocalTeam() {
  const state = useLocalState();
  return state.team
    ? { team: state.team, membership: { role: "owner" } }
    : null;
}

export function useLocalProjects() {
  return useLocalState().projects.filter(
    (project) => project.status === "active",
  );
}

export function useLocalWorkItems() {
  return useLocalState().workItems;
}

export function useLocalRules() {
  return useLocalState().rules;
}

export function useExtensionBridgeStatus() {
  return useLocalState().extensionBridgeStatus;
}

export function useUserPreferences() {
  return useLocalState().userPreferences;
}

export function useLocalTimeline(localDate: string) {
  useLocalState();
  return localStore.getTimeline(localDate);
}

export function useLocalTimelineActions() {
  return {
    assignBlock: useCallback(
      (block: ActivityBlockRecord, projectId: string) => {
        localStore.upsertEditedBlock({
          ...block,
          projectId,
          assignmentSource: "manual",
          status: "edited",
          locked: true,
        });
      },
      [],
    ),
    renameBlock: useCallback((block: ActivityBlockRecord, label: string) => {
      localStore.upsertEditedBlock({
        ...block,
        display: { ...block.display, label },
      });
    }, []),
    updateNote: useCallback((block: ActivityBlockRecord, note: string) => {
      localStore.upsertEditedBlock({
        ...block,
        note,
      });
    }, []),
    assignImportedBrowserDraft: useCallback(
      (draft: ImportedBrowserDraft, projectId: string) => {
        localStore.updateImportedBrowserDraft(draft._id, {
          projectId,
          status: projectId ? "assigned" : "draft",
          assignmentSource: projectId ? "manual" : "none",
          explanation: projectId
            ? "Assigned manually from the imported browser bucket."
            : "Assignment cleared. This bucket remains local until reviewed.",
        });
      },
      [],
    ),
    updateImportedBrowserDraftNote: useCallback(
      (draft: ImportedBrowserDraft, note: string) => {
        localStore.updateImportedBrowserDraft(draft._id, { note });
      },
      [],
    ),
    dismissBlock: localStore.dismissBlock,
    dismissImportedBrowserDraft:
      localStore.dismissImportedBrowserDraft.bind(localStore),
    commitBlock: localStore.commitBlock,
    commitImportedBrowserDraft:
      localStore.commitImportedBrowserDraft.bind(localStore),
    saveRuleFromBlock: localStore.saveRuleFromBlock,
    saveRuleFromImportedBrowserDraft:
      localStore.saveRuleFromImportedBrowserDraft.bind(localStore),
  };
}
