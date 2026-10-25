import { describe, expect, it } from "vitest";
import {
  pluginAccessDifference,
  summarizePluginAccess,
  widensAccess,
  type PluginAccessDifference,
} from "../plugin-access";
import { pluginApi4ManifestSchema } from "../plugin-api-4";
import { PLUGIN_API_VERSION, pluginManifestSchema } from "../plugins";
import {
  azureDevOpsManifest,
  gitHubManifest,
  icsManifest,
  workdayAgentManifest,
} from "./fixtures/api-4-manifests";

const PROMPTS = {
  "enter-week": "Enter week {{weekOf}}.",
  "submit-week": "Submit week {{weekOf}}.",
};

type Manifest = Record<string, any>;

function summary(
  manifest: Manifest,
  agentPrompts: Record<string, string> = PROMPTS,
) {
  return summarizePluginAccess(
    manifest.apiVersion === 4
      ? pluginApi4ManifestSchema.parse(manifest)
      : pluginManifestSchema.parse(manifest),
    { agentPrompts },
  );
}

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
  alwaysReady: false,
};

function difference(
  base: () => Manifest,
  change: (manifest: Manifest) => void,
  prompts: {
    before?: Record<string, string>;
    after?: Record<string, string>;
  } = {},
) {
  const before = base();
  const after = base();
  change(after);
  return pluginAccessDifference(
    summary(before, prompts.before),
    summary(after, prompts.after),
  );
}

describe("the access difference between two manifests", () => {
  it.each<
    [
      string,
      () => Manifest,
      (manifest: Manifest) => void,
      Partial<PluginAccessDifference>,
    ]
  >([
    [
      "a capability",
      gitHubManifest,
      (manifest) => {
        manifest.capabilities.calendar = {};
      },
      { capabilities: ["calendar"] },
    ],
    [
      "an auth scheme",
      gitHubManifest,
      (manifest) => {
        manifest.connectionFields.push({
          id: "login",
          label: "Login",
          type: "text",
        });
        manifest.network.auth = {
          scheme: "basic",
          userField: "login",
          secretField: "token",
        };
      },
      {
        authSchemes: [{ scheme: "basic", fields: ["login", "token"] }],
      },
    ],
    [
      "a host",
      icsManifest,
      (manifest) => {
        manifest.connectionFields.push({
          id: "server",
          label: "Server",
          type: "url",
          required: true,
        });
        manifest.network = {
          baseAddress: { field: "server" },
          endpoints: [{ method: "GET", path: "/feed.ics" }],
        };
      },
      {
        hosts: [{ kind: "baseAddress", field: "server" }],
        endpoints: [{ host: "base", method: "GET", path: "/feed.ics" }],
      },
    ],
    [
      "a derived host",
      azureDevOpsManifest,
      (manifest) => {
        manifest.network.derivedHosts.push({
          id: "release",
          forms: [{ whenHost: "dev.azure.com", host: "vsrm.{host}" }],
        });
      },
      {
        derivedHosts: [
          {
            id: "release",
            whenHost: "dev.azure.com",
            host: "vsrm.{host}",
            keepBasePath: true,
          },
        ],
      },
    ],
    [
      "a new form of a derived host",
      gitHubManifest,
      (manifest) => {
        manifest.network.derivedHosts[0].forms.splice(1, 0, {
          whenHost: "ghe.com",
          host: "api.ghe.com",
        });
      },
      {
        derivedHosts: [
          {
            id: "rest",
            whenHost: "ghe.com",
            host: "api.ghe.com",
            keepBasePath: true,
          },
        ],
      },
    ],
    [
      "an endpoint",
      azureDevOpsManifest,
      (manifest) => {
        manifest.network.endpoints.push({
          method: "DELETE",
          path: "/_apis/wit/workitems/*",
          access: "editWorkItems",
        });
      },
      {
        endpoints: [
          {
            host: "base",
            method: "DELETE",
            path: "/_apis/wit/workitems/*",
            access: "editWorkItems",
          },
        ],
      },
    ],
    [
      "an endpoint on a derived host",
      gitHubManifest,
      (manifest) => {
        manifest.network.derivedHosts[0].endpoints.push({
          method: "GET",
          path: "/repos/*/*/issues/**",
        });
      },
      {
        endpoints: [
          { host: "rest", method: "GET", path: "/repos/*/*/issues/**" },
        ],
      },
    ],
    [
      "an endpoint no longer behind an access choice",
      azureDevOpsManifest,
      (manifest) => {
        delete manifest.network.endpoints[3].access;
      },
      {
        endpoints: [
          { host: "base", method: "PATCH", path: "/_apis/wit/workitems/*" },
        ],
      },
    ],
    [
      "a public host",
      gitHubManifest,
      (manifest) => {
        manifest.network.publicHosts.push("raw.githubusercontent.com");
      },
      { publicHosts: ["raw.githubusercontent.com"] },
    ],
    [
      "an MCP tool",
      workdayAgentManifest,
      (manifest) => {
        manifest.capabilities.agentTask.tasks[1].tools.push("list_projects");
      },
      { mcpTools: [{ task: "submit-week", tool: "list_projects" }] },
    ],
    [
      "an access choice that is now always on",
      azureDevOpsManifest,
      (manifest) => {
        manifest.connectionAccess[1].always = true;
      },
      { alwaysOnAccess: ["editWorkItems"] },
    ],
    [
      "a new access choice that is always on",
      azureDevOpsManifest,
      (manifest) => {
        manifest.connectionAccess.push({
          id: "builds",
          label: "Builds",
          always: true,
        });
      },
      { alwaysOnAccess: ["builds"] },
    ],
    [
      "an operation added to an existing access choice",
      azureDevOpsManifest,
      (manifest) => {
        manifest.connectionAccess[1].operations.push("deleteWorkItem");
      },
      {
        accessOperations: [
          { choice: "editWorkItems", operation: "deleteWorkItem" },
        ],
      },
    ],
    [
      "an operation added to a choice that had none",
      azureDevOpsManifest,
      (manifest) => {
        manifest.connectionAccess[0].operations = ["readBacklog"];
      },
      {
        accessOperations: [{ choice: "readBacklog", operation: "readBacklog" }],
      },
    ],
    [
      "an operation moved to another access choice",
      azureDevOpsManifest,
      (manifest) => {
        manifest.connectionAccess[2].operations.push("postItemComment");
      },
      {
        accessOperations: [
          { choice: "pullRequests", operation: "postItemComment" },
        ],
      },
    ],
    [
      "a switch to always-ready",
      gitHubManifest,
      (manifest) => {
        manifest.runtime = { start: "alwaysReady" };
      },
      { alwaysReady: true },
    ],
  ])("lists only %s that was added", (_name, base, change, expected) => {
    expect(difference(base, change)).toEqual({ ...NOTHING, ...expected });
  });

  it("lists an agent task whose prompt changed", () => {
    expect(
      difference(workdayAgentManifest, () => {}, {
        after: { ...PROMPTS, "submit-week": "Submit and approve {{weekOf}}." },
      }),
    ).toEqual({ ...NOTHING, agentPrompts: ["submit-week"] });
  });

  it("lists a new agent task's prompt and tools", () => {
    expect(
      difference(
        workdayAgentManifest,
        (manifest) => {
          manifest.capabilities.agentTask.tasks.push({
            id: "review-week",
            label: "Review",
            placement: "commit-week",
            prompt: "prompts/review-week.md",
            estimateMinutes: 1,
            tools: ["get_week_status"],
          });
        },
        { after: { ...PROMPTS, "review-week": "Review {{weekOf}}." } },
      ),
    ).toEqual({
      ...NOTHING,
      mcpTools: [{ task: "review-week", tool: "get_week_status" }],
      agentPrompts: ["review-week"],
    });
  });

  it.each<[string, () => Manifest, (manifest: Manifest) => void]>([
    [
      "a new version and texts",
      gitHubManifest,
      (manifest) => {
        manifest.version = "4.1.0";
        manifest.displayName = "GitHub and Enterprise";
        manifest.description = "Now with more words.";
      },
    ],
    [
      "removed endpoints, hosts and capabilities",
      gitHubManifest,
      (manifest) => {
        manifest.capabilities = { codeHost: {} };
        manifest.network.derivedHosts.pop();
        manifest.network.publicHosts = [];
      },
    ],
    [
      "a reordered allowlist",
      azureDevOpsManifest,
      (manifest) => {
        manifest.network.endpoints.reverse();
      },
    ],
    [
      "a switch to load when needed",
      workdayAgentManifest,
      (manifest) => {
        manifest.runtime = { start: "whenNeeded" };
      },
    ],
    [
      "another memory ceiling, header list and access choice",
      azureDevOpsManifest,
      (manifest) => {
        manifest.runtime = { memoryCeilingMb: 1024 };
        manifest.network.requestHeaders.push("If-Match");
        manifest.connectionAccess.push({ id: "builds", label: "Builds" });
      },
    ],
    [
      "an access choice that is no longer always on",
      azureDevOpsManifest,
      (manifest) => {
        manifest.connectionAccess[0].always = false;
      },
    ],
    [
      "a removed operation",
      azureDevOpsManifest,
      (manifest) => {
        manifest.connectionAccess[1].operations.pop();
      },
    ],
    [
      "a reordered operation list",
      azureDevOpsManifest,
      (manifest) => {
        manifest.connectionAccess[1].operations.reverse();
      },
    ],
    [
      "a removed MCP tool",
      workdayAgentManifest,
      (manifest) => {
        manifest.capabilities.agentTask.tasks[0].tools.pop();
      },
    ],
  ])("lists nothing for %s", (_name, base, change) => {
    const result = difference(base, change);

    expect(result).toEqual(NOTHING);
    expect(widensAccess(result)).toBe(false);
  });

  it("widens access when it lists anything", () => {
    expect(
      widensAccess(
        difference(gitHubManifest, (manifest) => {
          manifest.network.publicHosts.push("raw.githubusercontent.com");
        }),
      ),
    ).toBe(true);
    expect(widensAccess({ ...NOTHING, alwaysReady: true })).toBe(true);
    expect(widensAccess({ ...NOTHING, alwaysOnAccess: ["builds"] })).toBe(true);
    expect(
      widensAccess({
        ...NOTHING,
        accessOperations: [{ choice: "editWorkItems", operation: "delete" }],
      }),
    ).toBe(true);
    expect(
      widensAccess(
        difference(azureDevOpsManifest, (manifest) => {
          manifest.connectionAccess[1].operations.push("deleteWorkItem");
        }),
      ),
    ).toBe(true);
  });

  it("lists everything a first API 4 release reaches, from API 3", () => {
    const api3 = {
      id: "ajc-ics",
      version: "3.2.0",
      apiVersion: PLUGIN_API_VERSION,
      displayName: "ICS calendar",
      iconSvg: "<svg/>",
      entrypoint: "dist/index.js",
      capabilities: { calendar: {} },
      connectionFields: [
        { id: "feedUrl", label: "Secret address", type: "url", secret: true },
      ],
    };

    expect(
      pluginAccessDifference(summary(api3), summary(icsManifest())),
    ).toEqual({
      ...NOTHING,
      authSchemes: [{ scheme: "secretAddress", fields: ["feedUrl"] }],
      hosts: [{ kind: "secretAddress", field: "feedUrl" }],
    });
  });

  it("lists everything when there is no previous manifest", () => {
    expect(
      pluginAccessDifference(undefined, summary(workdayAgentManifest())),
    ).toEqual({
      ...NOTHING,
      capabilities: ["agentTask", "projectProperties"],
      mcpTools: [
        { task: "enter-week", tool: "get_week_changes" },
        { task: "enter-week", tool: "get_week_status" },
        { task: "submit-week", tool: "get_week_status" },
        { task: "submit-week", tool: "submit_week" },
      ],
      agentPrompts: ["enter-week", "submit-week"],
      alwaysReady: true,
    });
  });
});

describe("the access summary", () => {
  it("lists what the plugin reaches, in a stable order", () => {
    expect(summary(gitHubManifest())).toEqual({
      capabilities: ["codeHost", "connector"],
      authSchemes: [{ scheme: "bearer", fields: ["token"] }],
      hosts: [{ kind: "baseAddress", field: "serverUrl" }],
      derivedHosts: [
        {
          id: "graphql",
          whenHost: "github.com",
          host: "api.github.com",
          keepBasePath: true,
        },
        {
          id: "graphql",
          host: "{host}",
          pathPrefix: "/api",
          keepBasePath: true,
        },
        {
          id: "rest",
          whenHost: "github.com",
          host: "api.github.com",
          keepBasePath: true,
        },
        {
          id: "rest",
          host: "{host}",
          pathPrefix: "/api/v3",
          keepBasePath: true,
        },
      ],
      endpoints: [
        { host: "graphql", method: "POST", path: "/graphql" },
        { host: "rest", method: "GET", path: "/repos/*/*/activity" },
      ],
      publicHosts: ["avatars.githubusercontent.com"],
      mcpTools: [],
      agentPrompts: [],
      alwaysOnAccess: [],
      accessOperations: [],
      startMode: "whenNeeded",
    });
  });

  it("lists each access choice's operations, sorted", () => {
    expect(summary(azureDevOpsManifest()).accessOperations).toEqual([
      { choice: "editWorkItems", operation: "postItemComment" },
      { choice: "editWorkItems", operation: "writeDescription" },
      { choice: "editWorkItems", operation: "writeSettle" },
      { choice: "peopleSearch", operation: "searchItemPeople" },
      { choice: "pullRequests", operation: "syncPullRequests" },
    ]);
  });

  it("needs every agent task's prompt, so a change can't go unseen", () => {
    expect(() =>
      summarizePluginAccess(
        pluginApi4ManifestSchema.parse(workdayAgentManifest()),
        {
          agentPrompts: { "enter-week": "Enter." },
        },
      ),
    ).toThrow('The prompt of agent task "submit-week" is missing.');
  });
});
