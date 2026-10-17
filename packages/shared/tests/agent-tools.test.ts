import { describe, expect, it } from "vitest";
import {
  bridgeToolResultSchema,
  dataToolOutputSchemas,
  isoDateSchema,
  readToolInputSchemas,
  writeToolInputSchemas,
} from "../agent-tools";

describe("agent tool contracts", () => {
  it("accepts a successful and a refused bridge result", () => {
    expect(
      bridgeToolResultSchema.parse({
        requestId: "r1",
        ok: true,
        output: { projects: [] },
      }),
    ).toMatchObject({ ok: true });
    expect(
      bridgeToolResultSchema.parse({
        requestId: "r2",
        ok: false,
        error: "Stop the running entry first",
      }),
    ).toMatchObject({ ok: false, error: "Stop the running entry first" });
  });

  it("marks a result that failed unexpectedly apart from a refusal", () => {
    const refusal = bridgeToolResultSchema.parse({
      requestId: "r1",
      ok: false,
      error: "Stop the running entry first",
    });
    const failure = bridgeToolResultSchema.parse({
      requestId: "r2",
      ok: false,
      error: "Boom",
      failed: true,
    });
    expect(refusal).not.toHaveProperty("failed");
    expect(failure).toMatchObject({ ok: false, failed: true });
  });

  it("fills list_work_items defaults so an empty call returns the sidebar", () => {
    expect(readToolInputSchemas.list_work_items.parse({})).toEqual({
      filter: "sidebar",
      limit: 50,
    });
  });

  it("rejects text that is not a real calendar date", () => {
    expect(isoDateSchema.safeParse("14/10/2026").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-13-45").success).toBe(false);
    expect(isoDateSchema.safeParse("2028-02-29").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-10-14").success).toBe(true);
  });

  it("reads only the checked changes unless asked otherwise", () => {
    expect(
      readToolInputSchemas.get_week_changes.parse({ weekOf: "2026-10-14" }),
    ).toEqual({ weekOf: "2026-10-14", onlyChecked: true });
  });

  it("reads a week's status and submits a week, each by any of its days", () => {
    expect(
      readToolInputSchemas.get_week_status.parse({ weekOf: "2026-10-18" }),
    ).toEqual({ weekOf: "2026-10-18" });
    expect(
      writeToolInputSchemas.submit_week.safeParse({
        weekOf: "next week",
        version: "v:0a1b2c3d",
      }).success,
    ).toBe(false);
    // submit_week takes the version get_week_status returned.
    expect(
      writeToolInputSchemas.submit_week.safeParse({ weekOf: "2026-10-12" })
        .success,
    ).toBe(false);
    expect(
      writeToolInputSchemas.submit_week.parse({
        weekOf: "2026-10-12",
        version: "v:0a1b2c3d",
      }),
    ).toEqual({ weekOf: "2026-10-12", version: "v:0a1b2c3d" });
    expect(
      dataToolOutputSchemas.submit_week.parse({
        weekOf: "2026-10-12",
        locked: true,
      }),
    ).toEqual({ weekOf: "2026-10-12", locked: true });
    expect(
      dataToolOutputSchemas.get_week_status.parse({
        weekOf: "2026-10-12",
        version: "v:0a1b2c3d",
        locked: false,
        uncommittedChanges: 0,
        committedHoursByDay: [{ date: "2026-10-12", hours: 7.5 }],
        committedEntries: [
          {
            entryId: "e1",
            externalId: "ajour:00000000",
            committed: { date: "2026-10-12", hours: 7.5 },
          },
        ],
        pace: {
          loggedHours: 7.5,
          targetHours: 40,
          expectedHours: 8,
          status: "on-pace",
        },
      }).committedEntries,
    ).toHaveLength(1);
  });

  it("needs at least one change, each with its version, to mark as committed", () => {
    const parse = (input: unknown) =>
      writeToolInputSchemas.mark_entries_committed.safeParse(input).success;

    expect(parse({ changes: [] })).toBe(false);
    expect(parse({ changes: [{ entryId: "e1" }] })).toBe(false);
    expect(parse({ entryIds: ["e1"] })).toBe(false);
    expect(parse({ changes: [{ entryId: "e1", version: "v:0a1b2c3d" }] })).toBe(
      true,
    );
  });

  it("accepts a deleted change with committed values only", () => {
    expect(
      dataToolOutputSchemas.get_week_changes.parse({
        changes: [
          {
            change: "deleted",
            entryId: "e1",
            externalId: "ajour:00000000",
            version: "v:00000000",
            checked: true,
            committed: { date: "2026-10-13", hours: 1 },
          },
        ],
      }).changes,
    ).toHaveLength(1);
  });
});
