import type { LocalAppState, UserPreferences } from "@/domain/local-state";
import { recordsEqual } from "@/domain/records-equal";
import { reroundTimesheetEntries } from "@/domain/time/time-rounding";

/**
 * Applies a change to the user's preferences. A new rounding re-rounds the
 * entries of the weeks not submitted, from their exact time. An unchanged
 * set of preferences leaves the state as it is.
 */
export function updateUserPreferences<State extends LocalAppState>(
  state: State,
  preferences: Partial<UserPreferences>,
): State {
  const userPreferences = { ...state.userPreferences, ...preferences };
  if (recordsEqual(userPreferences, state.userPreferences)) return state;
  const next = { ...state, userPreferences };
  return recordsEqual(
    userPreferences.timeRounding,
    state.userPreferences.timeRounding,
  )
    ? next
    : reroundTimesheetEntries(next);
}
