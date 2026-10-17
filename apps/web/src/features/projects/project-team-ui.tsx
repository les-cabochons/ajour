import { useState } from "react";
import { RiTeamLine as TeamIcon } from "@remixicon/react";
import { PropertyAction, PropertyRow } from "@/components/property-list";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showErrorToast, showToast } from "@/components/ui/toast";
import type { LocalProject } from "@/domain/local-state";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";
import {
  listTeamConnections,
  syncTeamConnection,
  type TeamConnectionChoice,
} from "@/lib/team-sync";

/*
 * Sharing a project with a team from its page: the Team row of the
 * properties card, Share with team, and Stop sharing. See the team project
 * sync design spec.
 */

/** Sends the change now instead of at the next interval. */
function syncSoon(team: TeamConnectionChoice) {
  void syncTeamConnection(team.pluginId, team.connectionId).catch(
    (error: unknown) =>
      showErrorToast({
        title: `${team.teamName} sync failed`,
        description: error instanceof Error ? error.message : undefined,
      }),
  );
}

/** The team a shared project belongs to, with whether it went to the team yet. */
export function ProjectTeamRow({
  project,
  teams,
}: {
  project: LocalProject;
  teams: readonly TeamConnectionChoice[];
}) {
  const link = project.team;
  if (!link) return null;
  const team = teams.find((entry) => entry.connectionId === link.connectionId);
  return (
    <PropertyRow label="Team">
      {team?.teamName ?? "A team that is off"}
      {link.remoteId ? null : (
        <span className="text-muted-foreground"> · sends at the next sync</span>
      )}
    </PropertyRow>
  );
}

/**
 * Share with team for a local project, or Stop sharing for a shared one.
 * Sharing shows the Undo toast and syncs when it closes. Stopping asks first:
 * it has no Undo, since the team's changes meanwhile would be skipped.
 */
export function ProjectTeamAction({
  project,
  teams,
  disabled,
}: {
  project: LocalProject;
  teams: readonly TeamConnectionChoice[];
  disabled: boolean;
}) {
  const [confirmingStop, setConfirmingStop] = useState(false);

  const share = async (team: TeamConnectionChoice) => {
    // The page's list can be stale: check the team is still connected and on.
    const current = await listTeamConnections().catch(() => []);
    if (!current.some((entry) => entry.connectionId === team.connectionId)) {
      showErrorToast({
        title: `Can't share ${project.name}`,
        description: `${team.teamName} is no longer connected, or its Projects switch is off.`,
      });
      return;
    }
    const { result, undoToken } = localStore.shareProjectWithTeam(
      team.connectionId,
      project._id,
    );
    if (result.kind === "shared") {
      offerUndo(undoToken, {
        title: `${project.name} shared with ${team.teamName}`,
        subject: "project",
        onWindowClosed: () => syncSoon(team),
      });
      return;
    }
    if (result.kind === "sameNameHeld") {
      // The team already has this project, waiting for an answer: sharing
      // it is linking to it.
      const linked = localStore.resolveTeamArrival(
        team.connectionId,
        result.remoteId,
        { kind: "link", projectId: project._id },
      );
      if (linked.kind === "linked") {
        showToast(`${project.name} linked to ${team.teamName}'s project`);
        syncSoon(team);
        return;
      }
    }
    showErrorToast({
      title: `Can't share ${project.name}`,
      description:
        result.kind === "sameNameShared"
          ? `${team.teamName} already has a project with this name here. Rename this one to share it.`
          : result.kind === "notSynced"
            ? `Sync ${team.teamName} once in Settings › Plugins first, so Ajour knows the team's projects.`
            : "Reload the project and try again.",
    });
  };

  if (project.team) {
    const team = teams.find(
      (entry) => entry.connectionId === project.team?.connectionId,
    );
    return (
      <>
        <PropertyAction
          disabled={disabled}
          onClick={() => setConfirmingStop(true)}
        >
          <TeamIcon aria-hidden="true" />
          Stop sharing
        </PropertyAction>
        <AlertDialog open={confirmingStop} onOpenChange={setConfirmingStop}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop sharing {project.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                It becomes a local project on this device, with its tasks and
                time entries. {team?.teamName ?? "The team"} keeps it, and its
                later changes no longer reach this device. This has no Undo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  localStore.unshareProjectFromTeam(project._id);
                  showToast(`${project.name} is local on this device`);
                }}
              >
                Stop sharing
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (teams.length === 0) return null;
  if (teams.length === 1) {
    return (
      <PropertyAction disabled={disabled} onClick={() => void share(teams[0]!)}>
        <TeamIcon aria-hidden="true" />
        Share with team
      </PropertyAction>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <PropertyAction>
            <TeamIcon aria-hidden="true" />
            Share with team…
          </PropertyAction>
        }
      />
      <DropdownMenuContent>
        {teams.map((team) => (
          <DropdownMenuItem
            key={team.connectionId}
            onClick={() => void share(team)}
          >
            {team.teamName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The shared mark on a project row. */
export function SharedProjectMark() {
  return (
    <span
      role="img"
      aria-label="Shared with a team"
      className="inline-flex shrink-0 text-muted-foreground [&_svg]:size-3.5"
    >
      <TeamIcon aria-hidden="true" />
    </span>
  );
}
