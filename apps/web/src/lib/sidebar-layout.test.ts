import { describe, expect, it } from "vitest";
import { parseSidebarLayout } from "@/lib/sidebar-layout";

describe("parseSidebarLayout", () => {
  it("keeps a saved project filter", () => {
    expect(parseSidebarLayout('{"projectId":"ajour"}').projectId).toBe("ajour");
  });

  it("drops a project filter that is not a project id", () => {
    for (const projectId of ['""', "42", "null"]) {
      expect(
        parseSidebarLayout(`{"projectId":${projectId}}`).projectId,
      ).toBeUndefined();
    }
  });
});
