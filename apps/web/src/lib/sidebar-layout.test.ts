import { describe, expect, it } from "vitest";
import { parseSidebarLayout } from "@/lib/sidebar-layout";

describe("parseSidebarLayout", () => {
  it("keeps a saved project filter", () => {
    expect(parseSidebarLayout('{"projectId":"ajour"}').projectId).toBe("ajour");
  });

  it("keeps a saved client filter, and drops one that is not a name", () => {
    expect(parseSidebarLayout('{"client":"Acme inc."}').client).toBe(
      "Acme inc.",
    );
    for (const client of ['""', "42", "null"]) {
      expect(parseSidebarLayout(`{"client":${client}}`).client).toBeUndefined();
    }
  });

  it("drops a project filter that is not a project id", () => {
    for (const projectId of ['""', "42", "null"]) {
      expect(
        parseSidebarLayout(`{"projectId":${projectId}}`).projectId,
      ).toBeUndefined();
    }
  });
});
