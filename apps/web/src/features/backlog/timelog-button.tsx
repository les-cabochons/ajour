import { useState } from "react";
import {
  RiErrorWarningLine as WarningIcon,
  RiFileTextLine as DescriptionIcon,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
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
import { Button } from "@/components/ui/button";
import type { TimelogMismatch } from "@/domain/backlog/description-timelog";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";

/**
 * The button after the Project property while the item's project or task
 * differs from its description's timelog (#281). A missing project or task
 * shows an amber warning that asks, then creates or restores it; in a shared
 * project the team gets the task too. When both exist, a quiet button sets
 * them at once. Every change has Undo.
 */
export function TimelogButton({
  workItemId,
  mismatch,
}: {
  workItemId: string;
  mismatch: TimelogMismatch;
}) {
  const [open, setOpen] = useState(false);

  function apply(title: string) {
    offerUndo(localStore.applyTimelogWithUndo(workItemId), {
      title,
      subject: "backlog item",
    });
  }

  if (mismatch.kind === "different") {
    const target = mismatch.taskName
      ? `${mismatch.projectName} › ${mismatch.taskName}`
      : mismatch.projectName;
    return (
      <TooltipButton
        label={`Use ${target} from the description`}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="timelog-button shrink-0 text-muted-foreground"
            onClick={() =>
              apply(
                mismatch.taskName
                  ? "Project and task set from the description"
                  : "Project set from the description",
              )
            }
          />
        }
      >
        <DescriptionIcon />
      </TooltipButton>
    );
  }

  const question = describeMissing(mismatch);
  return (
    <>
      <TooltipButton
        label={question.label}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="timelog-button shrink-0 text-[var(--warning)]"
            onClick={() => setOpen(true)}
          />
        }
      >
        <WarningIcon />
      </TooltipButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{question.title}</AlertDialogTitle>
            <AlertDialogDescription>{question.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                apply(question.done);
              }}
            >
              {question.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The question for a missing project or task, and the toast once done. */
function describeMissing(
  mismatch: Exclude<TimelogMismatch, { kind: "different" }>,
) {
  if (mismatch.kind === "missing-project") {
    const { projectName, taskName } = mismatch;
    const restores = Boolean(mismatch.archivedProjectId);
    const verb = restores ? "Restore" : "Create";
    return {
      label: `${verb} project ${projectName}`,
      title: `${verb} project ${projectName}?`,
      body: restores
        ? `The description's timelog names ${projectName}, an archived project. Ajour restores it${taskName ? `, adds the task ${taskName} if it's missing,` : ""} and sets it on this backlog item.`
        : `The description's timelog names ${projectName}, which doesn't exist. Ajour creates it${taskName ? ` with the task ${taskName}` : ""} and sets it on this backlog item.`,
      action: `${verb} project`,
      done: restores ? "Project restored" : "Project created",
    };
  }

  const { projectName, taskName, shared } = mismatch;
  const restores = Boolean(mismatch.archivedTaskId);
  const team = shared
    ? ` ${projectName} is shared, so your team gets the task too.`
    : "";
  return {
    label: restores
      ? `Restore task ${taskName}`
      : `Add task ${taskName} to ${projectName}`,
    title: restores
      ? `Restore task ${taskName} in ${projectName}?`
      : `Add task ${taskName} to ${projectName}?`,
    body: restores
      ? `The description's timelog names ${taskName}, which is archived in ${projectName}. Ajour restores it and sets it on this backlog item.${team}`
      : `The description's timelog names ${taskName}, which ${projectName} doesn't have. Ajour adds it and sets it on this backlog item.${team}`,
    action: restores ? "Restore task" : "Add task",
    done: restores ? "Task restored" : "Task added",
  };
}
