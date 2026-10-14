import { describe, expect, it } from "vitest";
import {
  bridgeToolResultSchema,
  isoDateSchema,
  readToolInputSchemas,
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

  it("fills list_work_items defaults so an empty call returns the sidebar", () => {
    expect(readToolInputSchemas.list_work_items.parse({})).toEqual({
      filter: "sidebar",
      limit: 50,
    });
  });

  it("rejects dates that are not ISO calendar dates", () => {
    expect(isoDateSchema.safeParse("14/10/2026").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-10-14").success).toBe(true);
  });
});
