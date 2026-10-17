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
import { showToast } from "@/components/ui/toast";
import { createTeam } from "@/lib/app-api";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import {
  buildPickerModel,
  describePickerResults,
  planPickerApply,
  type ArrivalChoice,
  type PickerResults,
} from "./team-picker";

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

/**
 * The one-time picker after joining, and later for each team project held
 * because a local project has its name. Link makes the local project the
 * shared one, so its time entries stay where they are. Nothing happens until
 * Apply, and it shows no Undo. What it offers and does is `team-picker.ts`.
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
  /** Runs after Apply changed something, to send it to the team now. */
  onApplied: () => void;
}) {
  const state = useLocalState();
  const [choices, setChoices] = useState<Record<string, ArrivalChoice>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<string[]>([]);
  const model = useMemo(
    () => buildPickerModel(state, connectionId, choices),
    [state, connectionId, choices],
  );

  const apply = () => {
    const plan = planPickerApply(model, checked);
    const results: PickerResults = {
      linked: 0,
      added: 0,
      shared: 0,
      failed: [],
    };
    const nameOf = (projectId: string) =>
      state.projects.find((project) => project._id === projectId)?.name ??
      "A project";
    for (const { remoteId, choice } of plan.resolutions) {
      const result = localStore.resolveTeamArrival(
        connectionId,
        remoteId,
        choice,
      );
      if (result.kind === "linked") results.linked += 1;
      else if (result.kind === "added") results.added += 1;
      else {
        results.failed.push(
          model.arrivals.find((entry) => entry.arrival.remoteId === remoteId)
            ?.arrival.name ?? "A team project",
        );
      }
    }
    for (const projectId of plan.shares) {
      const { result, undoToken } = localStore.shareProjectWithTeam(
        connectionId,
        projectId,
      );
      // Apply is the confirmation: no Undo, so the sync sends it now.
      if (undoToken) localStore.forgetUndo(undoToken);
      if (result.kind === "shared") results.shared += 1;
      else results.failed.push(nameOf(projectId));
    }

    setChoices({});
    setChecked(new Set());
    if (results.linked + results.added + results.shared > 0) onApplied();
    if (results.failed.length > 0) {
      // Keep the picker open on what is left, and say what did not go.
      setFailed(results.failed);
      return;
    }
    setFailed([]);
    onOpenChange(false);
    showToast(`${teamName}: ${describePickerResults(results)}`);
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

        {model.needsSync ? (
          <p className="text-sm text-muted-foreground">
            Ajour has not synced with {teamName} yet, so it does not know the
            team's projects. Press Sync on the connection first: projects the
            team already has can then be linked instead of shared twice.
          </p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto">
            {failed.length > 0 ? (
              <p className="text-sm break-words text-destructive">
                Not done: {failed.join(", ")}. The project or the team changed
                meanwhile. Check the lists below and apply again.
              </p>
            ) : null}

            {model.arrivals.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  The team already has these
                </h3>
                {model.arrivals.map(({ arrival, match, choice }) => (
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
                      value={choice}
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
                ))}
              </section>
            ) : null}

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                Share your projects
              </h3>
              {model.shareable.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No local projects to share.
                </p>
              ) : (
                model.shareable.map((project) => (
                  <label
                    key={project._id}
                    className="flex min-h-8 cursor-pointer items-center gap-3 text-sm"
                  >
                    <Checkbox
                      checked={checked.has(project._id)}
                      onCheckedChange={(isChecked) =>
                        setChecked((current) => {
                          const next = new Set(current);
                          if (isChecked) next.add(project._id);
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
              {model.blocked.map(({ project, reason }) => (
                <p key={project._id} className="text-xs text-muted-foreground">
                  {project.name} can't be shared here: {reason}.
                </p>
              ))}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button disabled={model.needsSync} onClick={apply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
