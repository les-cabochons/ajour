import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  applySettleRule,
  askSettleRule,
  findSettleRule,
  listSettleRuleSourceProjects,
  normalizeSettleRules,
} from "@/domain/backlog/settle-rules";

function synced(
  id: string,
  overrides: Partial<LocalWorkItem> = {},
): LocalWorkItem {
  return {
    _id: id,
    title: `Item ${id}`,
    status: "active",
    source: "azure_devops",
    sourceId: `source-${id}`,
    sourceConnectionId: "connection-1",
    sourceConnectionLabel: "Contoso",
    sourceProjectName: "Mercury",
    createdAt: 1,
    ...overrides,
  };
}

const mercury = {
  source: "azure_devops",
  connectionId: "connection-1",
  sourceProjectName: "Mercury",
};

function stateWith(overrides: Partial<LocalAppState>) {
  return { workItems: [], ...overrides } as unknown as LocalAppState;
}

describe("settle rules", () => {
  it("finds the Apply rule of the item's source project", () => {
    const rule = { ...mercury, state: { name: "Waiting", done: false } };

    expect(findSettleRule([rule], synced("a"))).toBe(rule);
    expect(
      findSettleRule([rule], synced("a", { sourceProjectName: "Venus" })),
    ).toBeUndefined();
    expect(
      findSettleRule([rule], synced("a", { sourceConnectionId: "other" })),
    ).toBeUndefined();
    expect(
      findSettleRule([rule], synced("a", { source: "manual" })),
    ).toBeUndefined();
    expect(findSettleRule(undefined, synced("a"))).toBeUndefined();
  });

  it("replaces a project's rule and puts it back to Ask", () => {
    const first = applySettleRule(stateWith({}), { ...mercury, priority: 1 });
    const second = applySettleRule(first, { ...mercury, priority: 2 });

    expect(second.settleRules).toEqual([{ ...mercury, priority: 2 }]);
    expect(askSettleRule(second, mercury).settleRules).toEqual([]);
    expect(askSettleRule(stateWith({}), mercury)).toEqual(stateWith({}));
  });

  it("lists each source project once, by connection then name, with an active sample", () => {
    expect(
      listSettleRuleSourceProjects([
        synced("archived", { status: "archived" }),
        synced("active"),
        synced("venus", { sourceProjectName: "Apollo" }),
        synced("manual", { source: "manual" }),
        synced("no-project", { sourceProjectName: undefined }),
      ]),
    ).toEqual([
      {
        ...mercury,
        sourceProjectName: "Apollo",
        connectionLabel: "Contoso",
        sampleSourceId: "source-venus",
      },
      {
        ...mercury,
        connectionLabel: "Contoso",
        sampleSourceId: "source-active",
      },
    ]);
  });

  it("keeps only well-formed persisted rules", () => {
    expect(
      normalizeSettleRules([
        {
          ...mercury,
          state: { name: "Waiting", done: false },
          priority: 2,
        },
        { ...mercury, state: { name: "" }, priority: 25 },
        { source: "azure_devops" },
        null,
      ]),
    ).toEqual([
      { ...mercury, state: { name: "Waiting", done: false }, priority: 2 },
      { ...mercury, state: undefined, priority: undefined },
    ]);
    expect(normalizeSettleRules(undefined)).toEqual([]);
  });
});
