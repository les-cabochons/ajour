import { describe, expect, it } from "vitest";
import type { PluginAccessDifference, PluginAccessView } from "@ajour/shared";
import {
  describeAccess,
  describeBlockedAttempts,
  describeLastRequest,
} from "./plugin-access-model";

const MINUTE = 60_000;

const labels = {
  fields: [
    { id: "organizationUrl", label: "Organization URL" },
    { id: "personalAccessToken", label: "Personal access token" },
  ],
  tasks: [{ id: "enter-week", label: "Enter the week" }],
};

const view: PluginAccessView = {
  summary: {
    capabilities: ["agentTask", "connector"],
    authSchemes: [
      {
        scheme: "patBasic",
        fields: ["personalAccessToken"],
      },
    ],
    hosts: [{ kind: "baseAddress", field: "organizationUrl" }],
    derivedHosts: [
      {
        id: "vssps",
        whenHost: "dev.azure.com",
        host: "vssps.{host}",
        keepBasePath: true,
      },
    ],
    endpoints: [
      { host: "base", method: "GET", path: "/_apis/connectionData" },
      {
        host: "base",
        method: "PATCH",
        path: "/_apis/wit/workitems/*",
        access: "editWorkItems",
      },
      {
        host: "vssps",
        method: "GET",
        path: "/_apis/identities",
        access: "peopleSearch",
      },
    ],
    publicHosts: ["avatars.example.com"],
    mcpTools: [{ task: "enter-week", tool: "get_week_status" }],
    agentPrompts: [{ task: "enter-week", prompt: "abc" }],
    alwaysOnAccess: [],
    accessOperations: [],
    startMode: "whenNeeded",
  },
  hostLabels: { vssps: "People in your organisation" },
  choices: [
    { id: "editWorkItems", label: "Edit work items", always: false },
    { id: "peopleSearch", label: "Search people", always: false },
  ],
};

const NOTHING: PluginAccessDifference = {
  capabilities: [],
  authSchemes: [],
  hosts: [],
  derivedHosts: [],
  endpoints: [],
  publicHosts: [],
  mcpTools: [],
  agentPrompts: [],
  alwaysOnAccess: [],
  accessOperations: [],
  ungatedOperations: [],
  alwaysReady: false,
};

describe("the Access section's lines", () => {
  it("lists hosts, the credential, agent tasks and the start mode in plain words", () => {
    const items = describeAccess(view, labels);

    expect(items.map((item) => [item.kind, item.title])).toEqual([
      ["network", 'The address in "Organization URL"'],
      ["network", "People in your organisation"],
      ["network", "avatars.example.com"],
      ["credential", 'The "Personal access token" on each connection'],
      ["agent", "Enter the week"],
      ["runtime", "Loads when needed"],
    ]);
    expect(items[1]!.detail).toBe(
      "Reaches vssps.dev.azure.com, worked out from the connection's address.",
    );
    expect(items[4]!.detail).toBe("Gets these Ajour tools: get_week_status.");
    expect(items.every((item) => !item.isNew)).toBe(true);
  });

  it("puts each host's endpoints behind a disclosure, with the choice that unlocks them", () => {
    const [base, people] = describeAccess(view, labels);

    expect(base!.endpoints).toEqual([
      { text: "GET /_apis/connectionData", isNew: false },
      {
        text: "PATCH /_apis/wit/workitems/*",
        gate: "Edit work items",
        isNew: false,
      },
    ]);
    expect(people!.endpoints).toEqual([
      {
        text: "GET /_apis/identities",
        gate: "Search people",
        isNew: false,
      },
    ]);
  });

  it("says when a plugin reaches nothing, has no credential and no agent tasks", () => {
    const items = describeAccess(
      {
        summary: {
          ...view.summary,
          authSchemes: [],
          hosts: [],
          derivedHosts: [],
          endpoints: [],
          publicHosts: [],
          mcpTools: [],
        },
        hostLabels: {},
        choices: [],
      },
      { fields: [], tasks: [] },
    );

    expect(items.map((item) => item.title)).toEqual([
      "No network access",
      "No credential",
      "No agent tasks",
      "Loads when needed",
    ]);
  });

  it("names a secret address as the credential and the destination", () => {
    const [credential] = describeAccess(
      {
        summary: {
          ...view.summary,
          authSchemes: [{ scheme: "secretAddress", fields: ["calendarUrl"] }],
          hosts: [{ kind: "secretAddress", field: "calendarUrl" }],
          derivedHosts: [],
          endpoints: [],
          publicHosts: [],
        },
        hostLabels: {},
        choices: [],
      },
      { fields: [{ id: "calendarUrl", label: "Calendar address" }], tasks: [] },
    ).filter((item) => item.kind !== "runtime");

    expect(credential).toMatchObject({
      kind: "credential",
      title: 'The secret address in "Calendar address"',
    });
  });

  it("marks what an update adds as New, and only the new endpoints of an old host", () => {
    const difference: PluginAccessDifference = {
      ...NOTHING,
      endpoints: [
        {
          host: "base",
          method: "PATCH",
          path: "/_apis/wit/workitems/*",
          access: "editWorkItems",
        },
      ],
      publicHosts: ["avatars.example.com"],
    };

    const items = describeAccess(view, labels, { difference });

    const base = items.find((item) => item.id === "host:organizationUrl")!;
    expect(base).toMatchObject({ isNew: false, hasNewEndpoints: true });
    expect(base.endpoints!.map((endpoint) => endpoint.isNew)).toEqual([
      false,
      true,
    ]);
    expect(
      items.find((item) => item.id === "public:avatars.example.com"),
    ).toMatchObject({ isNew: true });
  });
});

describe("the consent panel's lines", () => {
  it("lists only what is new, with only the new endpoints", () => {
    const items = describeAccess(view, labels, {
      onlyNew: true,
      difference: {
        ...NOTHING,
        endpoints: [
          {
            host: "base",
            method: "PATCH",
            path: "/_apis/wit/workitems/*",
            access: "editWorkItems",
          },
        ],
        derivedHosts: [view.summary.derivedHosts[0]!],
      },
    });

    expect(items.map((item) => item.title)).toEqual([
      'The address in "Organization URL"',
      "People in your organisation",
    ]);
    expect(items[0]!.endpoints).toEqual([
      {
        text: "PATCH /_apis/wit/workitems/*",
        gate: "Edit work items",
        isNew: true,
      },
    ]);
    expect(items[1]).toMatchObject({ isNew: true });
  });

  it("says a prompt changed, a tool was added and the plugin is always ready", () => {
    const items = describeAccess(
      { ...view, summary: { ...view.summary, startMode: "alwaysReady" } },
      labels,
      {
        onlyNew: true,
        difference: {
          ...NOTHING,
          agentPrompts: ["enter-week"],
          mcpTools: [{ task: "enter-week", tool: "submit_week" }],
          alwaysReady: true,
        },
      },
    );

    expect(items.map((item) => [item.title, item.detail])).toEqual([
      ["Enter the week", "Can now use submit_week. Its instructions changed."],
      ["Always ready", "Stays loaded in the background, using about 30 MB."],
    ]);
  });

  it("lists a new capability, an always-on choice and a removed gate", () => {
    const items = describeAccess(view, labels, {
      onlyNew: true,
      difference: {
        ...NOTHING,
        capabilities: ["codeHost"],
        alwaysOnAccess: ["editWorkItems"],
        accessOperations: [
          { choice: "peopleSearch", operation: "searchItemPeople" },
        ],
        ungatedOperations: ["writeSettle"],
      },
    });

    expect(items.map((item) => item.title)).toEqual([
      "Pull requests",
      "Edit work items",
      "Search people",
      "Actions that no longer wait for a choice",
    ]);
    expect(items.every((item) => item.isNew)).toBe(true);
  });
});

describe("the activity lines", () => {
  const now = new Date(2026, 9, 25, 15, 0).getTime();

  it.each([
    [undefined, "No requests yet."],
    [{ lastRequestAt: now - 20_000 }, "Last request just now."],
    [{ lastRequestAt: now - 3 * MINUTE }, "Last request 3 minutes ago."],
    [{ lastRequestAt: now - MINUTE }, "Last request 1 minute ago."],
    [{ lastRequestAt: now - 5 * 60 * MINUTE }, "Last request 5 hours ago."],
    [{ lastRequestAt: now - 3 * 24 * 60 * MINUTE }, "Last request 3 days ago."],
  ])("describes the last request of %j", (activity, expected) => {
    expect(describeLastRequest(activity, now)).toBe(expected);
  });

  it("says nothing without blocked attempts", () => {
    expect(describeBlockedAttempts(undefined, now)).toBeUndefined();
    expect(
      describeBlockedAttempts({ lastRequestAt: now - MINUTE }, now),
    ).toBeUndefined();
  });

  it("counts blocked attempts and says when the last one was", () => {
    const today = new Date(2026, 9, 25, 14, 32).getTime();
    expect(
      describeBlockedAttempts({ blockedCount: 2, lastBlockedAt: today }, now),
    ).toBe(
      "Tried to connect directly, blocked. 2 times, last at 14:32. Ajour sends a plugin's requests only through its own connections.",
    );
    const earlier = new Date(2026, 9, 22, 9, 5).getTime();
    expect(
      describeBlockedAttempts({ blockedCount: 1, lastBlockedAt: earlier }, now),
    ).toBe(
      "Tried to connect directly, blocked. 1 time, last on 22 Oct, 09:05. Ajour sends a plugin's requests only through its own connections.",
    );
  });
});
