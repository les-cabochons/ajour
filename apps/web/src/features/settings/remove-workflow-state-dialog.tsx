import { useState } from "react";
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
import { OptionSelect } from "@/components/ui/option-select";
import type { LocalWorkflowState } from "@/domain/local-state";

/** A workflow state the user asked to remove while items are in it. */
export interface WorkflowStateRemoval {
  state: LocalWorkflowState;
  itemCount: number;
  /** The states of its kind that can take its items, in board order. */
  targets: LocalWorkflowState[];
  /** The target that starts picked: the nearest one before it, else after. */
  defaultTargetId: string | undefined;
}

function formatItems(count: number) {
  return count === 1 ? "1 item is" : `${count} items are`;
}

/**
 * Asks before removing a workflow state that items use: names how many are
 * in it and where they go. Its items move to a state of the same kind, open
 * or done, so removing it never closes or reopens one. With no such state
 * left, they go to No state.
 */
export function RemoveWorkflowStateDialog({
  removal,
  onCancel,
  onRemove,
}: {
  removal: WorkflowStateRemoval | null;
  onCancel: () => void;
  onRemove: (moveItemsTo: string | undefined) => void;
}) {
  return (
    <AlertDialog
      open={removal !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        {removal ? (
          <RemovalQuestion
            key={removal.state._id}
            removal={removal}
            onRemove={onRemove}
          />
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RemovalQuestion({
  removal,
  onRemove,
}: {
  removal: WorkflowStateRemoval;
  onRemove: (moveItemsTo: string | undefined) => void;
}) {
  const [targetId, setTargetId] = useState(removal.defaultTargetId);
  const { state, itemCount, targets } = removal;

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove {state.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          {formatItems(itemCount)} in {state.name}.{" "}
          {targets.length > 0
            ? "Pick the state they move to."
            : "They will have no state."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {targets.length > 0 ? (
        <div className="flex items-center gap-3 text-sm">
          <label htmlFor="remove-workflow-state-target">Move them to</label>
          <OptionSelect
            id="remove-workflow-state-target"
            className="w-48"
            value={targetId ?? ""}
            onChange={setTargetId}
            options={targets.map((target) => ({
              value: target._id,
              label: target.name,
            }))}
          />
        </div>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          onClick={() => onRemove(targets.length > 0 ? targetId : undefined)}
        >
          Remove
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
