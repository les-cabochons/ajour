import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import type { LocalWorkflowState, LocalWorkItem } from "@/domain/local-state";

export function buildWorkflowStateLookup(statuses: LocalWorkflowState[]) {
  return new Map(statuses.map((status) => [status._id, status] as const));
}

export function buildWorkflowStateNameLookup(statuses: LocalWorkflowState[]) {
  return new Map(statuses.map((status) => [status._id, status.name] as const));
}

export function buildWorkflowStateOptions(
  statuses: LocalWorkflowState[],
): SearchableSelectOption[] {
  return statuses.map((status) => ({
    value: status._id,
    label: status.name,
    keywords: [status.name],
  }));
}

export function getWorkflowStateName(
  workflowStateId: string | undefined,
  workflowStateNameById: Map<string, string>,
) {
  return workflowStateId
    ? workflowStateNameById.get(workflowStateId)
    : undefined;
}

export function getImportedWorkflowStateSummary(
  workItem: Pick<
    LocalWorkItem,
    "importedWorkflowStateId" | "sourceStatusLabel"
  >,
  workflowStateNameById: Map<string, string>,
) {
  const importedName = getWorkflowStateName(
    workItem.importedWorkflowStateId,
    workflowStateNameById,
  );
  if (importedName) {
    return importedName;
  }

  const sourceStatusLabel = workItem.sourceStatusLabel?.trim();
  if (sourceStatusLabel) {
    return `${sourceStatusLabel} (unmapped)`;
  }

  return "empty";
}
