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

  it("matches the number a row shows when the plugin gave no external id", () => {
    // Synced before Ajour kept the external id: the row reads the number from
    // the link, or the key from a Jira source id.
    const azure = {
      title: "Week grid: keyboard editing of cells",
      source: "azure_devops" as const,
      sourceId: "48190",
      sourceUrl: "https://dev.azure.com/contoso/atlas/_workitems/edit/48190",
    };
    const jira = {
      title: "Harbor: offline sync conflict dialog",
      source: "jira" as const,
      sourceId: "HRB-412",
      sourceUrl: "https://contoso.atlassian.net/browse/HRB-412",
    };

    expect(createWorkItemSearch("48190", projects).matches(azure)).toBe(true);
    expect(createWorkItemSearch("4819", projects).matches(azure)).toBe(true);
    expect(createWorkItemSearch("HRB-412", projects).matches(jira)).toBe(true);
    expect(createWorkItemSearch("hrb-41", projects).matches(jira)).toBe(true);
    expect(createWorkItemSearch("HRB-412", projects).matches(azure)).toBe(
      false,
    );
  });

  it("reads a number written with its #, as rows and pull requests write it", () => {
    expect(createWorkItemSearch("#3311", projects).matches(billet)).toBe(true);
    expect(createWorkItemSearch("#150", projects).matches(billet)).toBe(false);
  });

  it("matches words typed without their space, such as weekgrid", () => {
    const item = { title: "Week grid: keyboard editing of cells" };

    expect(createWorkItemSearch("weekgrid", projects).matches(item)).toBe(true);
    expect(createWorkItemSearch("gridkey", projects).matches(item)).toBe(true);
    expect(createWorkItemSearch("weekcells", projects).matches(item)).toBe(
      false,
    );
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
