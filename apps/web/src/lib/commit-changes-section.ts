import { useSyncExternalStore } from "react";
import { recordDeviceSettingChange } from "@/lib/preference-events";

/**
 * The Commit page's Changes section is expanded or collapsed, and the choice
 * is saved per device for every week, so a user who folds the list away finds
 * it folded on the next visit. See "Submit timesheet" in
 * docs/agents/ux-spec.md.
 */
export type CommitChangesSectionState = "expanded" | "collapsed";

/** Per-device preference. It lives outside the local app state so it is never exported or bootstrapped. */
export const COMMIT_CHANGES_SECTION_STORAGE_KEY =
  "ajour.commit-changes-section";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** Unknown or missing values fall back to the expanded section. */
export function parseCommitChangesSectionPreference(
  value: string | null,
): CommitChangesSectionState {
  return value === "collapsed" ? "collapsed" : "expanded";
}

export function readCommitChangesSectionPreference(
  storage: PreferenceStorage | undefined,
): CommitChangesSectionState {
  try {
    return parseCommitChangesSectionPreference(
      storage?.getItem(COMMIT_CHANGES_SECTION_STORAGE_KEY) ?? null,
    );
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return "expanded";
  }
}

export function writeCommitChangesSectionPreference(
  storage: PreferenceStorage | undefined,
  state: CommitChangesSectionState,
) {
  recordDeviceSettingChange(
    "commit_changes_section",
    { state: readCommitChangesSectionPreference(storage) },
    { state },
    ["state"],
  );
  try {
    storage?.setItem(COMMIT_CHANGES_SECTION_STORAGE_KEY, state);
  } catch {
    // The preference then only lasts for this session.
  }
}

function getLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

let current: CommitChangesSectionState | undefined;
const listeners = new Set<() => void>();

function getState() {
  current ??= readCommitChangesSectionPreference(getLocalStorage());
  return current;
}

/**
 * Expands or collapses the Changes section and saves the choice for this
 * device. Every mounted Commit page follows it at once.
 */
export function setCommitChangesSection(next: CommitChangesSectionState) {
  writeCommitChangesSectionPreference(getLocalStorage(), next);
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The saved state of the Changes section, shared by every Commit page. */
export function useCommitChangesSection() {
  return useSyncExternalStore(subscribe, getState, () => "expanded" as const);
}
