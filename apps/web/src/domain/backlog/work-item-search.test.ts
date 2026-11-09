import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import { createWorkItemSearch } from "@/domain/backlog/work-item-search";

function project(overrides: Partial<LocalProject> & { _id: string }) {
  return {
    name: overrides._id,
    color: "#000000",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [],
    ...overrides,
  } satisfies LocalProject;
}

const projects = [
  project({
    _id: "oliva",
    name: "oliva-support",
    displayName: "Oliva",
    code: "OLV",
  }),
  project({ _id: "internal", name: "Internal" }),
];

const billet = {
  title: "Billet #11017098 - Réserver un lot",
  projectId: "oliva",
  sourceExternalId: "331150",
};

describe("createWorkItemSearch", () => {
  it("matches everything while the query is blank", () => {
    const search = createWorkItemSearch("  ", projects);

    expect(search.active).toBe(false);
    expect(search.matches({ title: "Anything" })).toBe(true);
  });

  it("matches the start of the item's number, not its middle", () => {
    expect(createWorkItemSearch("3311", projects).matches(billet)).toBe(true);
    expect(createWorkItemSearch("331150", projects).matches(billet)).toBe(true);
    expect(createWorkItemSearch("150", projects).matches(billet)).toBe(false);
    expect(
      createWorkItemSearch("pay-1", projects).matches({
        title: "Invoices",
        sourceExternalId: "PAY-12",
      }),
    ).toBe(true);
  });

  it("matches the title or the project, ignoring case and accents", () => {
    expect(createWorkItemSearch("RESERVER", projects).matches(billet)).toBe(
      true,
    );
    expect(createWorkItemSearch("olv", projects).matches(billet)).toBe(true);
    expect(createWorkItemSearch("support", projects).matches(billet)).toBe(
      true,
    );
    expect(createWorkItemSearch("winter", projects).matches(billet)).toBe(
      false,
    );
  });

  it("needs every word, each in the title, the project or the number", () => {
    expect(createWorkItemSearch("oliva 3311", projects).matches(billet)).toBe(
      true,
    );
    expect(
      createWorkItemSearch("internal 3311", projects).matches(billet),
    ).toBe(false);
  });

  it("tests any text with the same words, for rows that are not work items", () => {
    const search = createWorkItemSearch("api ajour", projects);

    expect(search.matchesText("Ajour API client")).toBe(true);
    expect(search.matchesText("Ajour web")).toBe(false);
  });
});
