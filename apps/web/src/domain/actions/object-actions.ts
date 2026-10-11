/**
 * Action sets for user-facing objects, from the action model in agents/ux-spec.md.
 *
 * Every surface (right-click menu, "…" menu, editors) renders the same list in the
 * same order. Kind decides which actions are listed. State decides which are enabled:
 * a disabled action stays listed with a short reason instead of disappearing.
 */
export interface ObjectAction<Id extends string = string> {
  id: Id;
  label: string;
  /** Destructive actions come last and use the destructive style. */
  destructive?: boolean;
  /** Present when the action is listed but unavailable in the current state. */
  disabledReason?: string;
  /** A side effect worth knowing before choosing the action. */
  hint?: string;
}

export type TimeEntryActionId =
  | "edit"
  | "continue"
  | "stop"
  | "duplicate"
  | "duplicate-to"
  | "move-to"
  | "delete"
  | "discard";

export type TimeEntryActionState = "saved" | "submitted" | "running";

export interface TimeEntryActionOptions {
  /** Whether the entry is on today's date. Continue resumes only today's entries. */
  isToday?: boolean;
  /** Set inside an editor, where Edit is the current mode. */
  isEditing?: boolean;
  /** Set inside an editor whose draft cannot be saved yet. */
  invalidDraftReason?: string;
}

const STOP_TIMER_FIRST = "Stop the timer first";
const MARKS_NOT_SUBMITTED = "Marks it as not submitted";

/** Lists a time entry's actions: Edit · Continue/Stop · Duplicate · Duplicate to… · Move to… · Delete/Discard. */
export function getTimeEntryActions(
  state: TimeEntryActionState,
  options: TimeEntryActionOptions = {},
): ObjectAction<TimeEntryActionId>[] {
  const isRunning = state === "running";
  const isSubmitted = state === "submitted";
  const relocationReason = isRunning
    ? STOP_TIMER_FIRST
    : options.invalidDraftReason;

  return [
    {
      id: "edit",
      label: "Edit",
      disabledReason: options.isEditing ? "Already editing" : undefined,
    },
    isRunning
      ? { id: "stop", label: "Stop" }
      : {
          id: "continue",
          label: "Continue",
          // Continuing today's entry adds time to it; another day's entry starts a new one.
          hint:
            isSubmitted && options.isToday ? MARKS_NOT_SUBMITTED : undefined,
        },
    { id: "duplicate", label: "Duplicate", disabledReason: relocationReason },
    {
      id: "duplicate-to",
      label: "Duplicate to…",
      disabledReason: relocationReason,
    },
    {
      id: "move-to",
      label: "Move to…",
      disabledReason: relocationReason,
      hint: isSubmitted ? MARKS_NOT_SUBMITTED : undefined,
    },
    isRunning
      ? { id: "discard", label: "Discard", destructive: true }
      : { id: "delete", label: "Delete", destructive: true },
  ];
}

/** Returns the action state shown for a time entry. */
export function getTimeEntryActionState(entry: {
  submittedAt?: number;
  isRunning?: boolean;
}): TimeEntryActionState {
  if (entry.isRunning) {
    return "running";
  }

  return entry.submittedAt ? "submitted" : "saved";
}
