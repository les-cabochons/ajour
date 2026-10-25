import type { SecretEntrySummary, SecretFieldSummary } from "@ajour/shared";

/**
 * What a saved secret shows instead of a mask: a state, its last use and its
 * reminder date. The API never sends a value, so every function here works
 * from the summary alone.
 */

/** How many days before its reminder date a secret starts to warn. */
export const EXPIRY_WARNING_DAYS = 7;

export type SecretStateKind =
  "saved" | "expiring" | "expired" | "rejected" | "unreadable" | "not_set";

export type SecretStateTone = "neutral" | "warning" | "danger";

export interface SecretState {
  kind: SecretStateKind;
  /** The chip's text. */
  label: string;
  tone: SecretStateTone;
  /** Whether the user has something to do about it. */
  needsAttention: boolean;
}

const DAY_MS = 86_400_000;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function startOfLocalDay(time: number) {
  const date = new Date(time);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** Whole local calendar days from `from` to `to`, so a DST change doesn't skew them. */
function calendarDaysBetween(from: number, to: number) {
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / DAY_MS);
}

/**
 * The chip of a saved secret, or of a field with none (`summary` undefined).
 * An unreadable secret and a rejected one come first, because they stop the
 * connection; then a reminder date that passed or falls within a week.
 */
export function describeSecret(
  summary:
    | (Pick<SecretEntrySummary, "expiresAt"> & {
        state: SecretFieldSummary["state"];
      })
    | undefined,
  now: number,
): SecretState {
  if (!summary) {
    return {
      kind: "not_set",
      label: "Not set",
      tone: "warning",
      needsAttention: true,
    };
  }
  if (summary.state === "unreadable") {
    return {
      kind: "unreadable",
      label: "Can't be read on this computer",
      tone: "danger",
      needsAttention: true,
    };
  }
  if (summary.state === "rejected") {
    return {
      kind: "rejected",
      label: "Token rejected",
      tone: "danger",
      needsAttention: true,
    };
  }
  if (summary.expiresAt !== undefined) {
    // The reminder date counts to the end of its day.
    const days = calendarDaysBetween(now, summary.expiresAt);
    if (summary.expiresAt <= now) {
      return {
        kind: "expired",
        label: `Expired on ${dateFormat.format(summary.expiresAt)}`,
        tone: "danger",
        needsAttention: true,
      };
    }
    if (days <= EXPIRY_WARNING_DAYS) {
      return {
        kind: "expiring",
        label:
          days <= 0
            ? "Expires today"
            : `Expires in ${days} ${days === 1 ? "day" : "days"}`,
        tone: "warning",
        needsAttention: true,
      };
    }
  }
  return {
    kind: "saved",
    label: "Saved",
    tone: "neutral",
    needsAttention: false,
  };
}

/** "Last used 2 hours ago", or "Not used yet". */
export function describeLastUse(lastUsedAt: number | undefined, now: number) {
  if (lastUsedAt === undefined) return "Not used yet";
  const elapsed = Math.max(0, now - lastUsedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Last used just now";
  if (minutes < 60) {
    return `Last used ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Last used ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = calendarDaysBetween(lastUsedAt, now);
  if (days === 1) return "Last used yesterday";
  if (days < 30) return `Last used ${days} days ago`;
  return `Last used ${dateFormat.format(lastUsedAt)}`;
}

/** A local calendar date as the form shows it, "2026-10-28", or "" for none. */
export function expiryToDateText(expiresAt: number | undefined) {
  if (expiresAt === undefined) return "";
  const date = new Date(expiresAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The reminder date a form's date text means: the end of that local day, so
 * the secret warns until the date is over. Null for no date, and for text
 * that isn't a date.
 */
export function dateTextToExpiry(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const end = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    23,
    59,
    59,
    999,
  );
  // 2026-02-31 rolls over to March: not a date.
  return end.getMonth() === Number(month) - 1 ? end.getTime() : null;
}
