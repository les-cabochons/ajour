import { describe, expect, it } from "vitest";
import {
  isTaskMergeDismissed,
  parseTaskMergeDismissals,
  withTaskMergeDismissal,
} from "@/lib/task-merge-dismissals";

describe("task merge dismissals", () => {
  const pair = { fromTaskId: "local", intoTaskId: "source" };

  it("remembers a pair the user said is not the same, in its project", () => {
    const dismissed = withTaskMergeDismissal([], "acme", pair);

    expect(isTaskMergeDismissed(dismissed, "acme", pair)).toBe(true);
    expect(isTaskMergeDismissed(dismissed, "globex", pair)).toBe(false);
    expect(
      isTaskMergeDismissed(dismissed, "acme", {
        fromTaskId: "local",
        intoTaskId: "other",
      }),
    ).toBe(false);
  });

  it("drops broken values", () => {
    expect(parseTaskMergeDismissals('["a:b:c", 3, null]')).toEqual(["a:b:c"]);
    expect(parseTaskMergeDismissals('{"a":1}')).toEqual([]);
    expect(parseTaskMergeDismissals("not json")).toEqual([]);
    expect(parseTaskMergeDismissals(null)).toEqual([]);
  });

  it("keeps the newest dismissals within the limit", () => {
    const dismissed = ["acme:a:b", "acme:c:d"];

    expect(withTaskMergeDismissal(dismissed, "acme", pair, 2)).toEqual([
      "acme:c:d",
      "acme:local:source",
    ]);
    expect(
      withTaskMergeDismissal(
        dismissed,
        "acme",
        { fromTaskId: "a", intoTaskId: "b" },
        2,
      ),
    ).toEqual(["acme:c:d", "acme:a:b"]);
  });
});
