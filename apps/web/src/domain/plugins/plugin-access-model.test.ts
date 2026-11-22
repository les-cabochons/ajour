import { describe, expect, it } from "vitest";
import type {
  PluginAccessDifference,
  PluginAccessView,
  PluginOverviewGroup,
} from "@ajour/shared";
import {
  describeAccess,
  describeAccessIntro,
  describeBlockedAttempts,
  describeRefusedRequests,
  FIRST_LIMITED_PLUGIN_API,
  hasListedAccess,
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
    requestHeaders: [],
    onPremises: false,
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
  requestHeaders: [],
  onPremises: false,
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

  it.each([
    ["handoff", "Handoff tools"],
    ["projectSource", "Project source"],
    ["timeSync", "Time sync"],
  ])("names a new %s capability in plain words", (capability, title) => {
    const items = describeAccess(view, labels, {
      onlyNew: true,
      difference: { ...NOTHING, capabilities: [capability] },
    });

    expect(items.map((item) => item.title)).toEqual([title]);
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

    expect(items.map((item) => [item.title, item.detail])).toEqual([
      ["Code host", "A feature this plugin didn't have before."],
      [
        "Edit work items",
        "Now always on. It no longer waits for you to turn it on.",
      ],
      ["Search people", "Now also lets a connection search people."],
      [
        "No longer behind an access choice: settle backlog items in the source",
        "Either it runs without a choice now, or the update removed it.",
      ],
    ]);
    expect(items.every((item) => item.isNew)).toBe(true);
  });

  it("names operations it has no words for as the plugin does", () => {
    const [ungated] = describeAccess(view, labels, {
      onlyNew: true,
      difference: {
        ...NOTHING,
        ungatedOperations: ["exportReport", "postItemComment"],
      },
    });

    expect(ungated).toMatchObject({
      title:
        "No longer behind an access choice: exportReport and post comments",
      detail:
        "Either they run without a choice now, or the update removed them.",
    });
  });

  it("lists new request headers and connections that may now be on-premises", () => {
    const items = describeAccess(
      {
        ...view,
        summary: {
          ...view.summary,
          requestHeaders: ["accept", "if-match"],
          onPremises: true,
        },
      },
      labels,
      {
        onlyNew: true,
        difference: {
          ...NOTHING,
          requestHeaders: ["if-match"],
          onPremises: true,
        },
      },
    );

    expect(items.map((item) => [item.title, item.detail])).toEqual([
      [
        "Addresses on your own network",
        "Only for a connection you mark on-premises.",
      ],
      ["Request headers", "It may set if-match on its requests."],
    ]);
  });
});

describe("the Access section's request headers and on-premises line", () => {
  it("lists every header the plugin may set, and marks only the new ones' line", () => {
    const items = describeAccess(
      {
        ...view,
        summary: {
          ...view.summary,
          requestHeaders: ["accept", "content-type"],
          onPremises: true,
        },
      },
      labels,
    );

    expect(
      items
        .filter((item) => item.id === "headers" || item.id === "onPremises")
        .map((item) => [item.title, item.detail, item.isNew]),
    ).toEqual([
      [
        "Addresses on your own network",
        "Only for a connection you mark on-premises.",
        false,
      ],
      [
        "Request headers",
        "It may set accept and content-type on its requests.",
        false,
      ],
    ]);
  });

  it("says nothing about headers or on-premises when the plugin has neither", () => {
    expect(
      describeAccess(view, labels).some(
        (item) => item.id === "headers" || item.id === "onPremises",
      ),
    ).toBe(false);
  });
});

describe("which plugins list their access", () => {
  const group = (apiVersion: number, withAccess: boolean) =>
    ({
      plugin: { apiVersion },
      ...(withAccess ? { access: view } : {}),
    }) as unknown as PluginOverviewGroup;

  it("lists the access of a plugin API 4 plugin the API described", () => {
    expect(hasListedAccess(group(FIRST_LIMITED_PLUGIN_API, true))).toBe(true);
    expect(hasListedAccess(group(FIRST_LIMITED_PLUGIN_API, false))).toBe(false);
    expect(hasListedAccess(group(3, true))).toBe(false);
  });
});

describe("what the Access section says first", () => {
  const LIMIT =
    "Ajour runs its code in a sandbox where its only way out is a request through Ajour, and limits every request to what is listed here.";
  const EXCEPTION =
    "Its agent tasks are the exception: a coding agent outside Ajour carries them out, and the list doesn't limit what that agent does.";

  it("says Ajour limits a plugin's requests to the list", () => {
    const text = describeAccessIntro({ listed: true, hasAgentTasks: false });
    expect(text).toBe(`What this plugin can reach. ${LIMIT}`);
  });

  it("does not say the list limits the agent that carries out an agent task", () => {
    const text = describeAccessIntro({ listed: true, hasAgentTasks: true });
    expect(text).toBe(`What this plugin can reach. ${LIMIT} ${EXCEPTION}`);
  });

  it("says a plugin on an older plugin API needs an update, whatever its tasks", () => {
    for (const hasAgentTasks of [false, true]) {
      expect(describeAccessIntro({ listed: false, hasAgentTasks })).toBe(
        "This plugin was built for an older plugin API, so Ajour doesn't run it. It needs an update.",
      );
    }
  });
});

describe("the activity lines", () => {
  const now = new Date(2026, 9, 25, 15, 0).getTime();
  const today = new Date(2026, 9, 25, 14, 32).getTime();
  const earlier = new Date(2026, 9, 22, 9, 5).getTime();

  it("says nothing without refused requests or blocked attempts", () => {
    expect(describeRefusedRequests(undefined, now)).toBeUndefined();
    expect(describeBlockedAttempts(undefined, now)).toBeUndefined();
    const onlyRequests = { lastRequestAt: now - MINUTE };
    expect(describeRefusedRequests(onlyRequests, now)).toBeUndefined();
    expect(describeBlockedAttempts(onlyRequests, now)).toBeUndefined();
  });

  it("counts requests the broker refused, apart from ways out the sandbox blocked", () => {
    const activity = {
      refusedCount: 2,
      lastRefusedAt: today,
      directBlockedCount: 1,
      lastDirectBlockedAt: earlier,
    };

    expect(describeRefusedRequests(activity, now)).toBe(
      "Asked for access it doesn't have, refused. 2 times, last at 14:32.",
    );
    expect(describeBlockedAttempts(activity, now)).toBe(
      "Tried to connect directly, blocked. 1 time, last on 22 Oct, 09:05. Ajour sends a plugin's requests only through its own connections.",
    );
    expect(
      describeBlockedAttempts({ refusedCount: 3, lastRefusedAt: today }, now),
    ).toBeUndefined();
  });
});

it.each(["patBasic", "secretAddress"] as const)(
  "states the process exception for %s credentials",
  (scheme) => {
    const items = describeAccess(
      {
        ...view,
        summary: {
          ...view.summary,
          authSchemes: [{ scheme, fields: ["personalAccessToken"] }],
          commands: [{ id: "run", argv: "git", policy: "{}" }],
        },
      },
      labels,
    );
    const credential = items.find((item) => item.kind === "credential");
    expect(credential?.detail).toContain("commands run as you");
    expect(credential?.detail).toContain(
      "every plugin's credentials, not only its own",
    );
    expect(credential?.detail).not.toMatch(/never sees/);
  },
);
it("names each scheme as opening another app on this computer", () => {
  const items = describeAccess(
    { ...view, summary: { ...view.summary, openSchemes: ["codex", "t3"] } },
    labels,
  );
  expect(
    items
      .filter((item) => item.id.startsWith("scheme:"))
      .map((item) => [item.title, item.detail]),
  ).toEqual([
    ["codex:", "Opens another app on this computer."],
    ["t3:", "Opens another app on this computer."],
  ]);
});

describe("the Access section's handoff connection lines", () => {
  const withTools = {
    ...labels,
    tools: [{ id: "opencode", label: "OpenCode" }],
  };

  it("lists each tool that hands off through a connection", () => {
    const items = describeAccess(
      {
        ...view,
        summary: { ...view.summary, handoffConnections: ["opencode"] },
      },
      withTools,
    );
    expect(
      items
        .filter((item) => item.id.startsWith("handoff-connection:"))
        .map((item) => [item.title, item.detail, item.isNew]),
    ).toEqual([
      [
        "OpenCode hands off through a connection",
        "Ajour detects the tool and reads its handoffs on the connection its settings pick. Its commands may receive that connection's address.",
        false,
      ],
    ]);
  });

  it("marks a tool that now uses a connection as New on the consent panel", () => {
    const items = describeAccess(
      {
        ...view,
        summary: { ...view.summary, handoffConnections: ["opencode"] },
      },
      withTools,
      {
        onlyNew: true,
        difference: { ...NOTHING, handoffConnections: ["opencode"] },
      },
    );
    expect(items.map((item) => [item.id, item.isNew])).toEqual([
      ["handoff-connection:opencode", true],
    ]);
  });

  it("names a tool by its id when its label is unknown, and says nothing without one", () => {
    expect(
      describeAccess(
        { ...view, summary: { ...view.summary, handoffConnections: ["x"] } },
        labels,
      ).find((item) => item.id === "handoff-connection:x")?.title,
    ).toBe("x hands off through a connection");
    expect(
      describeAccess(view, labels).some((item) =>
        item.id.startsWith("handoff-connection:"),
      ),
    ).toBe(false);
  });
});

describe("a plugin's declared commands (#821)", () => {
  /** A command as the API summarizes it, for the executable `executable`. */
  const command = (
    id: string,
    executable: string,
    names: string[],
    argv: string,
    description: string,
  ) => ({
    id,
    argv,
    policy: JSON.stringify({ command: { id, executable }, names }),
    description: `Executable names: ${names.join(", ")}. ${description}`,
  });
  const commands = [
    command(
      "thread-show",
      "t3",
      ["t3"],
      "t3 thread show <thread> --json",
      "Captures output. No stdin.",
    ),
    command(
      "claude-start",
      "claude",
      ["claude", "claude.exe"],
      "claude -p --cwd <folder>",
      "Opens in your terminal.",
    ),
    command(
      "thread-start",
      "t3",
      ["t3"],
      "t3 thread start <folder> - --json",
      "Captures output. Takes text on stdin.",
    ),
  ];
  const withCommands = (extra: Partial<PluginAccessView["summary"]> = {}) => ({
    ...view,
    summary: { ...view.summary, commands, ...extra },
  });
  const programs = (items: ReturnType<typeof describeAccess>) =>
    items.filter((item) => item.id.startsWith("program:"));

  it("lists one line per program, by name, with its commands and what each does", () => {
    const lines = programs(describeAccess(withCommands(), labels));
    expect(lines.map((line) => [line.title, line.detail, line.isNew])).toEqual([
      ["claude", "Executable names: claude, claude.exe.", false],
      ["t3", "Executable names: t3.", false],
    ]);
    expect(lines[1]!.commands).toEqual([
      {
        text: "t3 thread show <thread> --json",
        detail: "Captures output. No stdin.",
        isNew: false,
      },
      {
        text: "t3 thread start <folder> - --json",
        detail: "Captures output. Takes text on stdin.",
        isNew: false,
      },
    ]);
  });

  it("marks a program with a new command, and an update lists only that command", () => {
    const difference: PluginAccessDifference = {
      ...NOTHING,
      commands: [commands[2]!],
    };
    const all = programs(
      describeAccess(withCommands(), labels, { difference }),
    );
    const t3 = all.find((line) => line.title === "t3")!;
    expect([t3.isNew, t3.hasNewCommands]).toEqual([false, true]);
    expect(t3.commands?.map((line) => line.isNew)).toEqual([false, true]);
    expect(all.find((line) => line.title === "claude")?.hasNewCommands).toBe(
      false,
    );

    const update = programs(
      describeAccess(withCommands(), labels, { difference, onlyNew: true }),
    );
    expect(update.map((line) => line.title)).toEqual(["t3"]);
    expect(update[0]!.commands?.map((line) => line.text)).toEqual([
      "t3 thread start <folder> - --json",
    ]);
  });

  it("marks a program whose commands are all new as new, and keeps an interpreter's warning in sight", () => {
    const node = command(
      "run",
      "node",
      ["node"],
      "node <file>",
      "This command runs code it is given: as wide as Accept everything. Captures output.",
    );
    const [line] = programs(
      describeAccess(
        { ...view, summary: { ...view.summary, commands: [node] } },
        labels,
        { difference: { ...NOTHING, commands: [node] } },
      ),
    );
    expect(line).toMatchObject({
      title: "node",
      isNew: true,
      hasNewCommands: false,
      detail:
        "Executable names: node. It runs code it is given: as wide as Accept everything.",
    });
  });
});
