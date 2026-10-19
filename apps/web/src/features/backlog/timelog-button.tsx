import { useState } from "react";
import { RiErrorWarningLine as WarningIcon } from "@remixicon/react";
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
import type { MissingTimelogProject } from "@/domain/backlog/description-timelog";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";

/**
 * The warning beside the Project property when the description's timelog
 * names a project that does not exist (#281). It asks, then creates the
 * project, or restores an archived one of that name, with the timelog's task
 * and sets both on the item.
 */
export function TimelogProjectButton({
  workItemId,
  missing,
}: {
  workItemId: string;
  missing: MissingTimelogProject;
}) {
  const [open, setOpen] = useState(false);
  const restores = Boolean(missing.archivedProjectId);
  const verb = restores ? "Restore" : "Create";
  const { projectName, taskName } = missing;

  return (
    <>
      <TooltipButton
        label={`${verb} project ${projectName}`}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="timelog-project-button shrink-0 text-[var(--warning)]"
            onClick={() => setOpen(true)}
          />
        }
      >
        <WarningIcon />
      </TooltipButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {verb} project {projectName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {restores
                ? `The description's timelog names ${projectName}, an archived project. Ajour restores it${taskName ? `, adds the task ${taskName} if it's missing,` : ""} and sets it on this backlog item.`
                : `The description's timelog names ${projectName}, which doesn't exist. Ajour creates it${taskName ? ` with the task ${taskName}` : ""} and sets it on this backlog item.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                offerUndo(localStore.createTimelogProjectWithUndo(workItemId), {
                  title: restores ? "Project restored" : "Project created",
                  subject: "project",
                });
              }}
            >
              {verb} project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
