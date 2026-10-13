import { expect, it } from "vitest";
import { parseBacklogViewPreferences } from "./backlog-view-settings";
it("uses defaults for missing, broken or primitive settings", () => {
  for (const value of [null, "{", "null", "false", "42"])
    expect(parseBacklogViewPreferences(value).layout).toBe("list");
});
it("validates stored fields independently and keeps valid filters", () => {
  expect(
    parseBacklogViewPreferences(
      JSON.stringify({
        layout: "board",
        grouping: "bad",
        doneWindow: "all",
        properties: { id: false, priority: "false" },
        filters: [
          { field: "connection", value: "c" },
          null,
          { field: "bad", value: "1" },
        ],
      }),
    ),
  ).toMatchObject({
    layout: "board",
    grouping: "state",
    doneWindow: "all",
    properties: { id: false, priority: true },
    filters: [{ field: "connection", value: "c" }],
  });
});
