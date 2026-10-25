import { describe, expect, it } from "vitest";
import {
  dateTextToExpiry,
  describeLastUse,
  describeSecret,
  expiryToDateText,
} from "./secret-state";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 25, 10, 0, 0).getTime();
/** The end of the local day, `days` after today: how a reminder date is stored. */
const endOfDay = (days: number) =>
  new Date(2026, 9, 25 + days, 23, 59, 59, 999).getTime();

describe("describeSecret", () => {
  it("says Not set for a field with no secret", () => {
    expect(describeSecret(undefined, NOW)).toMatchObject({
      kind: "not_set",
      label: "Not set",
      needsAttention: true,
    });
  });

  it("says Saved for a secret with no reminder date, or one far away", () => {
    expect(describeSecret({ state: "saved" }, NOW)).toMatchObject({
      kind: "saved",
      label: "Saved",
      tone: "neutral",
      needsAttention: false,
    });
    expect(
      describeSecret({ state: "saved", expiresAt: endOfDay(8) }, NOW),
    ).toMatchObject({ kind: "saved" });
  });

  it("warns from seven days before the reminder date", () => {
    expect(
      describeSecret({ state: "saved", expiresAt: endOfDay(7) }, NOW),
    ).toMatchObject({ kind: "expiring", label: "Expires in 7 days" });
    expect(
      describeSecret({ state: "saved", expiresAt: endOfDay(5) }, NOW),
    ).toMatchObject({
      kind: "expiring",
      label: "Expires in 5 days",
      tone: "warning",
    });
    expect(
      describeSecret({ state: "saved", expiresAt: endOfDay(1) }, NOW),
    ).toMatchObject({ label: "Expires in 1 day" });
    expect(
      describeSecret({ state: "saved", expiresAt: endOfDay(0) }, NOW),
    ).toMatchObject({ kind: "expiring", label: "Expires today" });
  });

  it("says when the reminder date has passed", () => {
    expect(
      describeSecret({ state: "saved", expiresAt: NOW - 2 * DAY }, NOW),
    ).toMatchObject({
      kind: "expired",
      label: "Expired on 23 Oct 2026",
      tone: "danger",
    });
  });

  it("puts what stops the connection before a reminder", () => {
    const soon = endOfDay(2);
    expect(
      describeSecret({ state: "rejected", expiresAt: soon }, NOW),
    ).toMatchObject({ kind: "rejected", label: "Token rejected" });
    expect(
      describeSecret({ state: "unreadable", expiresAt: soon }, NOW),
    ).toMatchObject({
      kind: "unreadable",
      label: "Can't be read on this computer",
    });
  });
});

describe("describeLastUse", () => {
  it("counts from the last use in the unit that reads best", () => {
    expect(describeLastUse(undefined, NOW)).toBe("Not used yet");
    expect(describeLastUse(NOW - 20_000, NOW)).toBe("Last used just now");
    expect(describeLastUse(NOW - 12 * 60_000, NOW)).toBe(
      "Last used 12 minutes ago",
    );
    expect(describeLastUse(NOW - 2 * HOUR, NOW)).toBe("Last used 2 hours ago");
    expect(describeLastUse(new Date(2026, 9, 24, 3, 0).getTime(), NOW)).toBe(
      "Last used yesterday",
    );
    expect(describeLastUse(NOW - 9 * DAY, NOW)).toBe("Last used 9 days ago");
    expect(describeLastUse(new Date(2026, 7, 14).getTime(), NOW)).toBe(
      "Last used 14 Aug 2026",
    );
  });
});

describe("reminder dates", () => {
  it("round-trips a date through the end of its local day", () => {
    const expiry = dateTextToExpiry("2026-10-28");
    expect(expiry).toBe(new Date(2026, 9, 28, 23, 59, 59, 999).getTime());
    expect(expiryToDateText(expiry!)).toBe("2026-10-28");
  });

  it("reads no date, and text that isn't one, as none", () => {
    expect(dateTextToExpiry("")).toBeNull();
    expect(dateTextToExpiry("2026-10")).toBeNull();
    expect(dateTextToExpiry("2026-02-31")).toBeNull();
    expect(expiryToDateText(undefined)).toBe("");
  });
});
