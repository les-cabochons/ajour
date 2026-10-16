import { useMemo, useState } from "react";
import type { ConnectorFieldValues } from "@ajour/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { findLocalProjectNamed } from "@/domain/projects/team-sync";
import { createTeam } from "@/lib/app-api";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

/*
 * The team plugin's parts of Settings > Plugins: creating a team from the
 * connection form, and the picker that links the team's projects to local
 * ones and shares local projects. See the team project sync design spec.
 */

/**
 * Creates a team on the deployment the form names, and fills in the values
 * that join it. Joining instead means pasting a teammate's ID and secret.
 */
export function TeamCreateField({
  pluginId,
  values,
  disabled,
  onCreated,
}: {
  pluginId: string;
  values: ConnectorFieldValues;
  disabled: boolean;
  onCreated: (values: ConnectorFieldValues) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await createTeam(pluginId, {
        values,
        team: { name: name.trim() },
      });
      onCreated(result.values);
      setCreated(name.trim());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create the team.",
      );
    } finally {
      setCreating(false);
    }
  };

  if (created) {
    return (
      <p className="text-sm text-muted-foreground desktop:col-span-2">
        Created {created}. Its ID and secret are filled in: add the connection
        to save them, then pass them to your teammates.
      </p>
    );
  }

  return (
    <Field className="desktop:col-span-2">
      <FieldLabel htmlFor="team-create-name">New team</FieldLabel>
      <FieldContent>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="team-create-name"
            className="max-w-80 min-w-0 flex-1"
            placeholder="Team name"
            value={name}
            maxLength={120}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={disabled || creating || name.trim().length === 0}
            onClick={() => void create()}
          >
            {creating ? "Creating…" : "Create a team"}
          </Button>
        </div>
        {error ? (
          <p className="text-sm break-words text-destructive">{error}</p>
        ) : (
          <FieldDescription>
            Creates the team and fills in its ID and secret. To join a team
            instead, paste the ID and secret a teammate gave you.
          </FieldDescription>
        )}
      </FieldContent>
    </Field>
  );
}

/** Under a team connection: the team projects held for the user, if any. */
export function HeldArrivalsLine({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="text-xs text-[var(--text-tertiary)]">
      {count === 1
        ? "1 team project waits for you: the team has a project named like one of yours. Choose projects to link or add it."
        : `${count} team projects wait for you: the team has projects named like yours. Choose projects to link or add them.`}
    </p>
  );
}

type ArrivalChoice = "link" | "separate";

/**
 * The one-time picker after joining, and later for each team project held
 * because a local project has its name. Link makes the local project the
 * shared one, so its time entries stay where they are. Nothing happens until
 * Apply, and it shows no Undo.
 */
export function TeamPickerDialog({
  open,
  onOpenChange,
  connectionId,
  teamName,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  teamName: string;
  onApplied: (summary: string) => void;
}) {
  const state = useLocalState();
  const held = useMemo(
    () => state.teamConnections?.[connectionId]?.heldArrivals ?? [],
    [state.teamConnections, connectionId],
  );
  const localProjects = useMemo(
    () => state.projects.filter((project) => !project.team),
    [state.projects],
  );
  const [choices, setChoices] = useState<Record<string, ArrivalChoice>>({});
  const [shared, setShared] = useState<Set<string>>(new Set());

  const matchFor = (name: string) => findLocalProjectNamed(localProjects, name);
  const choiceFor = (remoteId: string, name: string): ArrivalChoice =>
    choices[remoteId] ?? (matchFor(name) ? "link" : "separate");
  const linkedLocalIds = new Set(
    held.flatMap((arrival) =>
      choiceFor(arrival.remoteId, arrival.name) === "link"
        ? [matchFor(arrival.name)?._id ?? ""]
        : [],
    ),
  );
  const shareable = localProjects.filter(
    (project) =>
      project.status === "active" && !linkedLocalIds.has(project._id),
  );

  const apply = () => {
    let linked = 0;
    let added = 0;
    for (const arrival of held) {
      const match = matchFor(arrival.name);
      const choice = choiceFor(arrival.remoteId, arrival.name);
      const result = localStore.resolveTeamArrival(
        connectionId,
        arrival.remoteId,
        choice === "link" && match
          ? { kind: "link", projectId: match._id }
          : { kind: "addSeparately" },
      );
      if (result.kind === "linked") linked += 1;
      if (result.kind === "added") added += 1;
    }
    let sharedCount = 0;
    for (const projectId of shared) {
      if (linkedLocalIds.has(projectId)) continue;
      const { result, undoToken } = localStore.shareProjectWithTeam(
        connectionId,
        projectId,
      );
      // The picker's Apply is the confirmation: no Undo, so the sync sends it now.
      if (undoToken) localStore.forgetUndo(undoToken);
      if (result.kind === "shared") sharedCount += 1;
    }
    setChoices({});
    setShared(new Set());
    onOpenChange(false);
    onApplied(
      [
        linked ? `${linked} linked` : null,
        added ? `${added} added` : null,
        sharedCount ? `${sharedCount} shared` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Nothing changed",
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Projects with {teamName}</DialogTitle>
          <DialogDescription>
            Shared projects keep their name, code, color, icon, tasks and
            budgets in step with the team. Your time entries and notes never
            leave this device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto">
          {held.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                The team already has these
              </h3>
              {held.map((arrival) => {
                const match = matchFor(arrival.name);
                return (
                  <div
                    key={arrival.remoteId}
                    className="flex min-h-10 items-center justify-between gap-4"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: arrival.color }}
                      />
                      <span className="truncate">{arrival.name}</span>
                    </span>
                    <OptionSelect<ArrivalChoice>
                      label={`What to do with ${arrival.name}`}
                      size="sm"
                      className="w-56 shrink-0"
                      value={choiceFor(arrival.remoteId, arrival.name)}
                      onChange={(value) =>
                        setChoices((current) => ({
                          ...current,
                          [arrival.remoteId]: value,
                        }))
                      }
                      options={[
                        ...(match
                          ? [
                              {
                                value: "link" as const,
                                label: `Link to your ${match.name}`,
                              },
                            ]
                          : []),
                        { value: "separate", label: "Add as its own project" },
                      ]}
                    />
                  </div>
                );
              })}
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Share your projects
            </h3>
            {shareable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No local projects to share.
              </p>
            ) : (
              shareable.map((project) => (
                <label
                  key={project._id}
                  className="flex min-h-8 cursor-pointer items-center gap-3 text-sm"
                >
                  <Checkbox
                    checked={shared.has(project._id)}
                    onCheckedChange={(checked) =>
                      setShared((current) => {
                        const next = new Set(current);
                        if (checked) next.add(project._id);
                        else next.delete(project._id);
                        return next;
                      })
                    }
                  />
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="truncate">{project.name}</span>
                </label>
              ))
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
