import { describe, expect, it } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  getHandoffCloseAction,
  getHandoffChip,
  getHandoffItem,
  getHandoffItemKeys,
  getHandoffItemRefusal,
  getHandoffMarks,
  getHandoffToolNote,
  getHandoffToolsChoice,
  isHandoffFollowed,
  listHandoffTools,
  parseHandoffToolKey,
  pickHandoffTool,
  sameHandoffMarks,
} from "./handoffs";
import {
  handoffOverview,
  handoffRecord,
} from "../../../tests/fixtures/handoffs";

describe("handoff tools", () => {
  it("lists every tool of an active handoff plugin, unknown until detected", () => {
    const tools = listHandoffTools(handoffOverview(), new Map());
    expect(tools.map((tool) => [tool.key, tool.label, tool.available])).toEqual(
      [
        ["agent-handoff:t3", "T3 Code", undefined],
        ["agent-handoff:claude", "Claude Code", undefined],
      ],
    );
  });

  it("marks each tool on or off as its switch on the plugin's page says", () => {
    const tools = listHandoffTools(
      handoffOverview({ enabled: ["claude"] }),
      new Map(),
    );
    expect(tools.map((tool) => [tool.toolId, tool.enabled])).toEqual([
      ["t3", false],
      ["claude", true],
    ]);
    // An overview from an API without switches reads every tool as off.
    const older = handoffOverview();
    delete older.connectionGroups[0]!.enabledHandoffTools;
    expect(
      listHandoffTools(older, new Map()).map((tool) => tool.enabled),
    ).toEqual([false, false]);
  });

  it("leads to the tool list while no tool is on: the plugin's page, or the plugins list when several plugins hand off", () => {
    expect(getHandoffToolsChoice(handoffOverview())).toBeUndefined();
    expect(getHandoffToolsChoice(handoffOverview({ enabled: [] }))).toEqual({
      page: "plugins/agent-handoff",
      search: { section: "handoff-tools" },
    });

    const two = handoffOverview({ enabled: [] });
    const other = structuredClone(two.connectionGroups[0]!);
    other.plugin = { ...other.plugin, id: "other-handoff" };
    two.connectionGroups.push(other);
    expect(getHandoffToolsChoice(two)).toEqual({ page: "plugins" });
    // One tool on anywhere: the menus list it, and nothing asks to choose.
    two.connectionGroups[1]!.enabledHandoffTools = ["t3"];
    expect(getHandoffToolsChoice(two)).toBeUndefined();

    // A plugin that is off, or no handoff plugin, asks nothing.
    const off = handoffOverview({ enabled: [] });
    off.connectionGroups[0]!.enabled = false;
    expect(getHandoffToolsChoice(off)).toBeUndefined();
    expect(getHandoffToolsChoice(null)).toBeUndefined();
  });

  it("marks tools detection didn't find as missing, with the plugin's reason", () => {
    const tools = listHandoffTools(
      handoffOverview(),
      new Map([
        [
          "agent-handoff",
          [
            { id: "t3", available: true, version: "0.9.0" },
            { id: "claude", available: false, reason: "claude isn't on PATH." },
          ],
        ],
      ]),
    );
    expect(tools.map((tool) => [tool.available, tool.reason])).toEqual([
      [true, undefined],
      [false, "claude isn't on PATH."],
    ]);
  });

  it("lists nothing while the plugin, its capability or plugins are off", () => {
    const off = handoffOverview();
    off.connectionGroups[0]!.enabled = false;
    const capabilityOff = handoffOverview();
    capabilityOff.connectionGroups[0]!.inactiveCapabilities = ["handoff"];
    const pluginsOff = handoffOverview();
    pluginsOff.pluginsEnabled = false;
    for (const overview of [off, capabilityOff, pluginsOff, null])
      expect(listHandoffTools(overview, new Map())).toEqual([]);
  });

  it("keeps the last tool while it can run, else takes the first that can", () => {
    const tools = listHandoffTools(
      handoffOverview(),
      new Map([
        [
          "agent-handoff",
          [
            { id: "t3", available: true },
            { id: "claude", available: true },
          ],
        ],
      ]),
    );
    expect(pickHandoffTool(tools, "agent-handoff:claude")?.toolId).toBe(
      "claude",
    );
    expect(pickHandoffTool(tools, undefined)?.toolId).toBe("t3");
    const missing = tools.map((tool) =>
      tool.toolId === "claude" ? { ...tool, available: false } : tool,
    );
    expect(pickHandoffTool(missing, "agent-handoff:claude")?.toolId).toBe("t3");
    expect(
      pickHandoffTool(
        tools.map((tool) => ({ ...tool, available: false })),
        undefined,
      ),
    ).toBeUndefined();
  });

  it("says a tool that doesn't follow state only starts threads, unless it can't run", () => {
    const tools = listHandoffTools(
      handoffOverview({ copilot: true }),
      new Map(),
    );
    expect(tools.map((tool) => [tool.toolId, tool.followsState])).toEqual([
      ["t3", true],
      ["claude", true],
      ["copilot", false],
    ]);
    expect(tools.map(getHandoffToolNote)).toEqual([
      undefined,
      undefined,
      "Starts a thread; doesn't report progress",
    ]);
    expect(
      getHandoffToolNote({
        ...tools[2]!,
        available: false,
        reason: "copilot isn't on PATH.",
      }),
    ).toBe("copilot isn't on PATH.");
  });

  it("names the close each tool offers, and asks first only before a delete (#850)", () => {
    const [t3, claude] = listHandoffTools(
      handoffOverview({ closes: { t3: "delete", claude: "archive" } }),
      new Map(),
    );
    expect(getHandoffCloseAction(claude)).toEqual({
      kind: "archive",
      label: "Close in Claude Code",
      done: "Closed in Claude Code and removed from the item.",
      failure: "Couldn't close the thread",
    });
    expect(getHandoffCloseAction(t3)).toEqual({
      kind: "delete",
      label: "Delete in T3 Code",
      done: "Deleted in T3 Code and removed from the item.",
      failure: "Couldn't delete the thread",
      confirm: {
        title: "Delete this thread in T3 Code?",
        body: "T3 Code deletes its conversation for good, and Ajour removes it from this item.",
        action: "Delete",
      },
    });
    // A tool that can't close threads, or one no plugin names now, has none.
    const [plain] = listHandoffTools(handoffOverview(), new Map());
    expect(getHandoffCloseAction(plain)).toBeUndefined();
    expect(getHandoffCloseAction(undefined)).toBeUndefined();
  });

  it("splits a key at its last colon", () => {
    expect(parseHandoffToolKey("org:agent-handoff:t3")).toEqual({
      pluginId: "org:agent-handoff",
      toolId: "t3",
    });
    expect(parseHandoffToolKey("t3")).toBeUndefined();
  });
});

describe("handoff items", () => {
  const parent = {
    _id: "parent",
    title: "Login",
    sourceId: "ado-1",
    sourceExternalId: "PAY-1",
  } as LocalWorkItem;
  const item = {
    _id: "child",
    title: "Fix login redirect",
    description: "Steps",
    sourceExternalId: "PAY-12",
    sourceUrl: "https://dev.azure.com/acme/_workitems/edit/12",
    sourceWorkItemType: "Bug",
    parentSourceId: "ado-1",
    projectId: "project-1",
    status: "active",
  } as LocalWorkItem;

  it("sends the key, title, description, url, type and parent", () => {
    expect(getHandoffItem(item, [parent, item])).toEqual({
      key: "PAY-12",
      title: "Fix login redirect",
      description: "Steps",
      url: "https://dev.azure.com/acme/_workitems/edit/12",
      type: "Bug",
      parent: { key: "PAY-1", title: "Login" },
    });
  });

  it.each([
    [
      "a GitHub issue, by its full name and its number",
      {
        source: "github",
        sourceExternalId: "acme/api#12",
        sourceUrl: "https://github.com/acme/api/issues/12",
      },
      ["acme/api#12", "12"],
    ],
    [
      "a Jira issue, by its key",
      {
        source: "jira",
        sourceExternalId: "PAY-12",
        sourceUrl: "https://acme.atlassian.net/browse/PAY-12",
      },
      ["PAY-12"],
    ],
    [
      "an Azure DevOps work item, by its number",
      {
        source: "azure-devops",
        sourceExternalId: "1234",
        sourceUrl: "https://dev.azure.com/acme/pay/_workitems/edit/1234",
      },
      ["1234"],
    ],
    [
      "an item synced before its source kept an id, by the end of its link",
      {
        source: "azure-devops",
        sourceUrl: "https://dev.azure.com/acme/pay/_workitems/edit/1234",
      },
      ["1234"],
    ],
    ["a local item, by nothing", { source: "manual" }, []],
    [
      "an item whose source id no title's brackets could hold, by its shown key only",
      {
        source: "jira",
        sourceExternalId: "[PAY-12] ",
        sourceUrl: "https://acme.atlassian.net/browse/PAY-12",
      },
      ["PAY-12"],
    ],
  ])("names %s", (_, fields, keys) => {
    expect(getHandoffItemKeys(fields as LocalWorkItem)).toEqual(keys);
  });

  it("refuses an item without a project, and an archived one", () => {
    expect(getHandoffItemRefusal(item)).toBeUndefined();
    expect(getHandoffItemRefusal({ ...item, projectId: undefined })).toBe(
      "Add the item to a project first",
    );
    expect(getHandoffItemRefusal({ ...item, status: "archived" })).toBe(
      "Restore the item first",
    );
  });
});

describe("handoff states", () => {
  it.each([
    ["working", "Working", "success"],
    ["needs-you", "Needs you", "warning"],
    ["ready", "Ready", "neutral"],
    ["done", "Done", "neutral"],
    ["failed", "Failed", "danger"],
    ["gone", "Gone", "muted"],
    ["unknown", "Unknown", "muted"],
  ] as const)("shows %s as %s in %s", (state, label, tone) => {
    expect(getHandoffChip(handoffRecord({ state }))).toEqual({
      label,
      tone,
      detail: "Running in T3",
    });
  });

  it("shows a started handoff muted, with when it started and why it stays so", () => {
    const record = handoffRecord({
      toolId: "copilot",
      state: "started",
      startedAt: 60_000,
      native: { label: "ignored" },
    });
    expect(
      getHandoffChip(record, { toolLabel: "Copilot CLI", now: 6 * 60_000 }),
    ).toEqual({
      label: "Started",
      tone: "muted",
      detail:
        "Started in Copilot CLI 5 min ago. Copilot CLI doesn't report progress here; open it there to follow it.",
    });
    expect(getHandoffMarks([record]).size).toBe(0);
    // Its tool follows state again: Unknown until the tool answers.
    expect(getHandoffChip(record, { followsState: true })).toEqual({
      label: "Unknown",
      tone: "muted",
    });
  });

  it("follows a handoff by its tool's say now, else by the record", () => {
    const started = handoffRecord({ state: "started" });
    const working = handoffRecord({ state: "working" });
    expect(isHandoffFollowed(started, { followsState: true })).toBe(true);
    expect(isHandoffFollowed(working, { followsState: false })).toBe(false);
    expect(isHandoffFollowed(started, undefined)).toBe(false);
    expect(isHandoffFollowed(working, undefined)).toBe(true);
  });

  it("shows a paused handoff muted, with the reason in the tooltip", () => {
    expect(
      getHandoffChip(
        handoffRecord({
          paused: { reason: "The plugin is off.", since: 5 },
        }),
      ),
    ).toEqual({ label: "Paused", tone: "muted", detail: "The plugin is off." });
  });

  it("falls back to the tool's status, then to its last recorded label", () => {
    expect(
      getHandoffChip(handoffRecord({ native: { status: "idle" } })).detail,
    ).toBe("idle");
    expect(
      getHandoffChip(
        handoffRecord({
          native: {},
          history: [{ state: "ready", label: "Settled", at: 3 }],
        }),
      ).detail,
    ).toBe("Settled");
  });

  it("marks rows only for working or needs-you threads, needs-you first", () => {
    const marks = getHandoffMarks([
      handoffRecord({ id: "a", workItemId: "one", state: "working" }),
      handoffRecord({ id: "b", workItemId: "one", state: "needs-you" }),
      handoffRecord({ id: "c", workItemId: "one", state: "working" }),
      handoffRecord({ id: "d", workItemId: "two", state: "done" }),
      handoffRecord({ id: "e", workItemId: "three", state: "working" }),
      handoffRecord({
        id: "f",
        workItemId: "four",
        state: "working",
        paused: { reason: "off", since: 1 },
      }),
    ]);
    expect([...marks]).toEqual([
      ["one", "needs-you"],
      ["three", "working"],
    ]);
    expect(sameHandoffMarks(marks, new Map(marks))).toBe(true);
    expect(sameHandoffMarks(marks, new Map([["one", "working"]]))).toBe(false);
  });
});
