import { describe, expect, it } from "vitest";
import {
  getDuplicateProjectNameWarning,
  getDuplicateTaskNameWarning,
  normalizeProjectCode,
  PROJECT_CODE_ERROR,
} from "@/domain/projects/project-names";

describe("project codes", () => {
  it("trims and uppercases a code", () => {
    expect(normalizeProjectCode("  atl ")).toEqual({ ok: true, code: "ATL" });
    expect(normalizeProjectCode("acme-sup")).toEqual({
      ok: true,
      code: "ACME-SUP",
    });
  });

  it("reads an empty code as no code", () => {
    expect(normalizeProjectCode("   ")).toEqual({ ok: true, code: undefined });
  });

  it("refuses spaces, signs and long codes instead of cutting them", () => {
    for (const text of [
      "ab c",
      "atl!",
      "toolongcode1",
      "ab c-123 toolongcode!!",
    ]) {
      expect(normalizeProjectCode(text)).toEqual({
        ok: false,
        error: PROJECT_CODE_ERROR,
      });
    }
    expect(normalizeProjectCode("ABCDEFGHIJ")).toEqual({
      ok: true,
      code: "ABCDEFGHIJ",
    });
  });
});

describe("duplicate names", () => {
  const projects = [
    { _id: "atlas", name: "Atlas Platform", displayName: "Atlas" },
    { _id: "beta", name: "Beta" },
  ];

  it("warns about another project with the full or display name", () => {
    expect(getDuplicateProjectNameWarning(projects, " beta ")).toBe(
      "Another project is named Beta.",
    );
    expect(getDuplicateProjectNameWarning(projects, "atlas")).toBe(
      "Another project is named Atlas.",
    );
    expect(getDuplicateProjectNameWarning(projects, "Beta", "beta")).toBeNull();
    expect(getDuplicateProjectNameWarning(projects, "Gamma")).toBeNull();
  });

  it("warns about another task of the project with the name", () => {
    const tasks = [
      { _id: "design", name: "Design", status: "active" as const },
      { _id: "old", name: "Research", status: "archived" as const },
    ];
    expect(getDuplicateTaskNameWarning("Atlas", tasks, "design")).toBe(
      "Atlas already has a task named Design.",
    );
    expect(getDuplicateTaskNameWarning("Atlas", tasks, "Research")).toBe(
      "Atlas already has an archived task named Research.",
    );
    expect(
      getDuplicateTaskNameWarning("Atlas", tasks, "Design", "design"),
    ).toBeNull();
  });
});
