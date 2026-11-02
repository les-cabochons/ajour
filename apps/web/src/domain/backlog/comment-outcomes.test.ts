import { describe, expect, it } from "vitest";
import {
  commentOutcomeDisabledReason,
  commentOutcomeForKeys,
  commentOutcomeLabel,
} from "@/domain/backlog/comment-outcomes";

const synced = { source: "azure_devops", sourceUrl: "https://example.test/1" };

describe("the outcome ⌘/Ctrl+Enter runs", () => {
  it("is the saved one with no other key held", () => {
    expect(commentOutcomeForKeys({ shift: false, alt: false }, "snooze")).toBe(
      "snooze",
    );
  });

  it("is settle with Shift and snooze with Alt, whatever is saved", () => {
    expect(commentOutcomeForKeys({ shift: true, alt: false }, "comment")).toBe(
      "settle",
    );
    expect(commentOutcomeForKeys({ shift: false, alt: true }, "settle")).toBe(
      "snooze",
    );
  });

  it("is nothing with Shift and Alt together, which the editor doesn't bind", () => {
    expect(
      commentOutcomeForKeys({ shift: true, alt: true }, "comment"),
    ).toBeUndefined();
  });
});

describe("the outcome's label", () => {
  it("ends Settle with an ellipsis only when it opens the settle dialog", () => {
    expect(commentOutcomeLabel("settle", { settleOpensDialog: true })).toBe(
      "Comment and settle…",
    );
    expect(commentOutcomeLabel("settle", { settleOpensDialog: false })).toBe(
      "Comment and settle",
    );
    expect(commentOutcomeLabel("snooze", { settleOpensDialog: false })).toBe(
      "Comment and snooze…",
    );
    expect(commentOutcomeLabel("comment", { settleOpensDialog: true })).toBe(
      "Comment",
    );
  });
});

describe("why an outcome can't run", () => {
  it("lets an active item take every outcome", () => {
    const item = { ...synced, status: "active" as const };
    for (const outcome of ["comment", "settle", "snooze"] as const) {
      expect(
        commentOutcomeDisabledReason(item, outcome, { isSnoozed: false }),
      ).toBeUndefined();
    }
  });

  it("gives a settled item the action menus' reasons", () => {
    const item = { ...synced, status: "settled" as const };
    const reason = (outcome: "settle" | "snooze") =>
      commentOutcomeDisabledReason(item, outcome, { isSnoozed: false });
    expect(reason("snooze")).toBe("Unsettle the item first");
    expect(reason("settle")).toBe("The item is already settled");
  });

  it("asks to restore an archived item first", () => {
    const item = { ...synced, status: "archived" as const };
    for (const outcome of ["settle", "snooze"] as const) {
      expect(
        commentOutcomeDisabledReason(item, outcome, { isSnoozed: false }),
      ).toBe("Restore the item first");
    }
  });

  it("doesn't snooze a snoozed item again, but settles it", () => {
    const item = { ...synced, status: "active" as const };
    expect(
      commentOutcomeDisabledReason(item, "snooze", { isSnoozed: true }),
    ).toBe("The item is already snoozed");
    expect(
      commentOutcomeDisabledReason(item, "settle", { isSnoozed: true }),
    ).toBeUndefined();
  });

  it("always lets the comment go alone", () => {
    const item = { ...synced, status: "archived" as const };
    expect(
      commentOutcomeDisabledReason(item, "comment", { isSnoozed: true }),
    ).toBeUndefined();
  });
});
