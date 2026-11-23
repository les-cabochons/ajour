import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  WORKTREE_CLEAN_UP_DELAYS,
  worktreeStartInLabels,
  worktreeStartInSchema,
  type ListedWorktree,
  type WorktreeCleanUpRule,
  type WorktreeCleanUpRuleName,
  type WorktreeSettings,
  type WorktreeSettingsUpdate,
  type WorktreeStartIn,
} from "@ajour/shared/worktrees";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { OptionSelect } from "@/components/ui/option-select";
import { Switch } from "@/components/ui/switch";
import { showErrorToast, showToast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  describeCleanUpDelay,
  describeListedWorktree,
  describeWorktreeItem,
} from "@/domain/handoffs/worktrees";
import { WorktreeRow } from "@/features/worktrees/worktree-row";
import { getWorktreeSettings, saveWorktreeSettings } from "@/lib/app-api";
import { useLocalState } from "@/lib/local-hooks";
import {
  listWorktreesWithCleanUp,
  onWorktreeCleanUp,
  runWorktreeCleanUp,
} from "@/lib/worktree-clean-up";
import { publishDefaultStartIn } from "@/lib/worktrees";

/** The choices in the order the row shows them. */
const START_IN_CHOICES: readonly WorktreeStartIn[] = [
  "main",
  "worktree",
  "ask",
];

/** The two rules as their rows name them, in the order the page shows them. */
const RULES: readonly {
  name: WorktreeCleanUpRuleName;
  label: string;
  description: string;
}[] = [
  {
    name: "finished",
    label: "Remove worktrees of finished items",
    description: "Done, settled or archived.",
  },
  {
    name: "unused",
    label: "Remove unused worktrees",
    description: "No hand off and no thread change.",
  },
];

/**
 * The delays a rule's select offers, with the saved one among them when a
 * state file holds another number of days.
 */
function delayOptions(days: number) {
  return [...new Set([...WORKTREE_CLEAN_UP_DELAYS, days])]
    .sort((a, b) => a - b)
    .map((value) => ({
      value: String(value),
      label: describeCleanUpDelay(value),
    }));
}

/** One clean-up rule: its delay, then its switch. */
function CleanUpRuleRow({
  label,
  description,
  rule,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  /** Undefined until the local API answered. */
  rule: WorktreeCleanUpRule | undefined;
  disabled: boolean;
  onChange: (rule: WorktreeCleanUpRule) => void;
}) {
  const switchId = useId();
  return (
    <SettingRow label={label} labelFor={switchId} description={description}>
      <OptionSelect
        label={`${label}: delay`}
        className="w-32"
        disabled={disabled || !rule}
        value={String(rule?.days ?? "")}
        onChange={(days) => {
          if (rule) onChange({ ...rule, days: Number(days) });
        }}
        options={rule ? delayOptions(rule.days) : []}
      />
      <Switch
        id={switchId}
        disabled={disabled || !rule}
        checked={rule?.enabled ?? false}
        onCheckedChange={(enabled) => {
          if (rule) onChange({ ...rule, enabled });
        }}
      />
    </SettingRow>
  );
}

/** What a round did, as its toast says it. */
function describeRound(removed: readonly { name: string }[]): string {
  if (!removed.length) return "Nothing to remove";
  return removed.length === 1
    ? `Removed ${removed[0]!.name}`
    : `Removed ${removed.length} worktrees`;
}

/**
 * Settings › Worktrees (#860, #864), on this computer: where a hand off
 * starts, the main folder, a new worktree, or asked at each hand off; the
 * two rules by which Ajour removes worktrees by itself, each a switch with
 * its delay; and every worktree on this computer, grouped by project, with
 * what clean up will do with it. The local API keeps the settings, so the
 * page shows what the API answers: a pick is saved at once, and a save the
 * API refuses leaves the saved value selected and says so.
 */
export function SettingsWorktreesPage() {
  const state = useLocalState();
  const [settings, setSettings] = useState<WorktreeSettings>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // The worktrees of this computer, and when their status was read.
  const [list, setList] = useState<{
    listed: ListedWorktree[];
    readAt: number;
  }>();
  const [listError, setListError] = useState<string>();
  const [cleaning, setCleaning] = useState(false);

  // The number of the last list request. Only its answer is shown: an
  // older request can answer later, with a worktree removed since.
  const lastRequest = useRef(0);
  const loadList = useCallback(() => {
    const request = ++lastRequest.current;
    void listWorktreesWithCleanUp().then(
      (listed) => {
        if (request !== lastRequest.current) return;
        setList({ listed, readAt: Date.now() });
        setListError(undefined);
      },
      () => {
        if (request === lastRequest.current)
          setListError("Couldn't read the worktrees of this computer.");
      },
    );
  }, []);

  useEffect(() => {
    let active = true;
    getWorktreeSettings().then(
      (answer) => {
        if (active) setSettings(answer);
      },
      () => {
        if (active) setError("Couldn't read where hand offs start.");
      },
    );
    loadList();
    // A round the app started by itself may remove a worktree the list
    // still shows: the list is read again when any round completes.
    const stop = onWorktreeCleanUp(loadList);
    return () => {
      active = false;
      stop();
    };
  }, [loadList]);

  /** Saves one change, and answers whether the API took it. */
  const save = (update: WorktreeSettingsUpdate, failed: () => void) => {
    setSaving(true);
    setError(undefined);
    return saveWorktreeSettings(update)
      .then(
        (answer) => {
          setSettings(answer);
          // A project page open under Settings names the default it follows.
          if (update.startIn) publishDefaultStartIn(answer.startIn);
          return true;
        },
        () => {
          failed();
          return false;
        },
      )
      .finally(() => setSaving(false));
  };

  const saveStartIn = (next: WorktreeStartIn) => {
    if (next === settings?.startIn) return;
    void save({ startIn: next }, () =>
      setError("Couldn't save where hand offs start."),
    );
  };

  const saveRule = (name: WorktreeCleanUpRuleName, rule: WorktreeCleanUpRule) =>
    void save({ cleanUp: { [name]: rule } }, () =>
      // The row goes back to the saved rule, and a toast says why.
      showErrorToast({
        title: "Couldn't save the clean-up rule",
        description: "The local API didn't answer.",
      }),
    ).then((saved) => {
      // A rule decides what each row says: "Goes Nov 22" moves with it.
      if (saved) loadList();
    });

  const cleanUpNow = () => {
    setCleaning(true);
    void runWorktreeCleanUp("manual")
      .then(
        (answer) => showToast(describeRound(answer?.removed ?? [])),
        () =>
          showErrorToast({
            title: "Couldn't clean up",
            description: "The local API didn't answer.",
          }),
      )
      // The round itself tells the list to read again (`onWorktreeCleanUp`).
      .finally(() => setCleaning(false));
  };

  const startIn = settings?.startIn;
  const projectName = (projectId: string) =>
    state.projects.find((project) => project._id === projectId)?.name ??
    "A project Ajour no longer has";
  // One group per project, by name. Inside one, newest first, as read.
  const groups = [...new Set(list?.listed.map((one) => one.worktree.projectId))]
    .map((projectId) => ({
      projectId,
      name: projectName(projectId),
      listed: list!.listed.filter(
        (one) => one.worktree.projectId === projectId,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="settings-sections settings-measure">
      <section className="settings-section">
        <h2 className="settings-section-title">New hand offs</h2>
        <p className="settings-section-desc">
          Where a hand off to a coding tool starts when its project doesn't say.
          On this computer.
        </p>
        <AppPanel>
          <SettingRow
            label="Start in"
            description={
              // Two lines always, so an error never moves the page.
              <span className="flex h-8 min-w-0 flex-col overflow-hidden">
                <span className="truncate">
                  A new worktree goes in the repository's .ajour/worktrees.
                </span>
                <span
                  role="alert"
                  className="truncate text-destructive"
                  title={error}
                >
                  {error ?? " "}
                </span>
              </span>
            }
          >
            <ToggleGroup
              aria-label="Start in"
              variant="outline"
              // Until the API answers, no choice shows as the saved one.
              disabled={saving || startIn === undefined}
              value={startIn ? [startIn] : []}
              onValueChange={(values) => {
                const next = worktreeStartInSchema.safeParse(values[0]);
                if (next.success) saveStartIn(next.data);
              }}
            >
              {START_IN_CHOICES.map((choice) => (
                <ToggleGroupItem key={choice} value={choice}>
                  {worktreeStartInLabels[choice]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingRow>
        </AppPanel>
      </section>

      <section className="settings-section" aria-label="Clean up">
        <h2 className="settings-section-title">Clean up</h2>
        <p className="settings-section-desc">
          Ajour keeps a worktree with uncommitted changes or a running thread,
          and always keeps its branch.
        </p>
        <AppPanel>
          {RULES.map(({ name, label, description }) => (
            <CleanUpRuleRow
              key={name}
              label={label}
              description={description}
              rule={settings?.cleanUp[name]}
              disabled={saving}
              onChange={(rule) => saveRule(name, rule)}
            />
          ))}
        </AppPanel>
      </section>

      <section className="settings-section" aria-label="On this computer">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="settings-section-title min-w-0 flex-1">
            On this computer
          </h2>
          <Button
            variant="outline"
            size="sm"
            disabled={cleaning}
            onClick={cleanUpNow}
          >
            Clean up now
          </Button>
        </div>
        {listError ? (
          <p role="alert" className="text-sm text-destructive">
            {listError}
          </p>
        ) : list && !groups.length ? (
          <p className="text-sm text-muted-foreground">
            No worktree on this computer. A hand off that starts in a new
            worktree makes one.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.projectId}>
              <h3 className="mb-1 truncate text-xs font-medium text-muted-foreground">
                {group.name}
              </h3>
              <ul aria-label={`Worktrees of ${group.name}`}>
                {group.listed.map((one) => (
                  <WorktreeRow
                    key={one.worktree.id}
                    listed={one}
                    title={describeWorktreeItem(one.worktree, state.workItems)}
                    status={describeListedWorktree(one, list!.readAt)}
                    onChanged={loadList}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
