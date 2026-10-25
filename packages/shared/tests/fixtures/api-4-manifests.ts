/**
 * API 4 manifests shaped like the plugins Ajour ships, as decided in #219 and
 * the spec #381. Tests copy and change them.
 */

// Loose, so tests can break them in any way.
export type Fixture = Record<string, any>;

const ICON = "<svg viewBox='0 0 16 16' />";

export function azureDevOpsManifest(): Fixture {
  return {
    id: "ajc-azure-devops",
    version: "4.0.0",
    apiVersion: 4,
    displayName: "Azure DevOps",
    iconSvg: ICON,
    entrypoint: "dist/index.js",
    connectionFields: [
      {
        id: "organizationUrl",
        label: "Organization URL",
        type: "url",
        required: true,
      },
      {
        id: "personalAccessToken",
        label: "Personal access token",
        type: "password",
        required: true,
        secret: true,
      },
      { id: "project", label: "Project", type: "text" },
    ],
    capabilities: {
      connector: { settle: true, comments: { mentions: true } },
      codeHost: {},
    },
    network: {
      auth: { scheme: "patBasic", secretField: "personalAccessToken" },
      baseAddress: { field: "organizationUrl", allowOnPremises: true },
      endpoints: [
        { method: "GET", path: "/_apis/connectionData" },
        { method: "POST", path: "/*/_apis/wit/wiql" },
        { method: "POST", path: "/_apis/wit/workitemsbatch" },
        {
          method: "PATCH",
          path: "/_apis/wit/workitems/*",
          access: "editWorkItems",
        },
        {
          method: "GET",
          path: "/*/_apis/git/pullrequests",
          access: "pullRequests",
        },
        {
          method: "GET",
          path: "/*/_apis/git/repositories/*/pullRequests/**",
          access: "pullRequests",
        },
      ],
      derivedHosts: [
        {
          id: "vssps",
          forms: [
            { whenHost: "dev.azure.com", host: "vssps.{host}" },
            {
              whenHost: "*.visualstudio.com",
              host: "{match}.vssps.visualstudio.com",
              keepBasePath: false,
            },
          ],
          endpoints: [
            {
              method: "GET",
              path: "/_apis/identities",
              access: "peopleSearch",
            },
          ],
        },
      ],
      requestHeaders: ["Accept", "Content-Type"],
    },
    connectionAccess: [
      {
        id: "readBacklog",
        label: "Read the backlog",
        always: true,
        tokenScope: "Work Items (Read)",
      },
      {
        id: "editWorkItems",
        label: "Edit work items",
        tokenScope: "Work Items (Read & write)",
        operations: ["writeSettle", "postItemComment", "writeDescription"],
      },
      {
        id: "pullRequests",
        label: "Pull requests",
        tokenScope: "Code (Read)",
        operations: ["syncPullRequests"],
      },
      {
        id: "peopleSearch",
        label: "Search people across the organisation",
        tokenScope: "Identity (Read)",
        operations: ["searchItemPeople"],
      },
    ],
  };
}

export function gitHubManifest(): Fixture {
  return {
    id: "ajc-github",
    version: "4.0.0",
    apiVersion: 4,
    displayName: "GitHub",
    iconSvg: ICON,
    entrypoint: "dist/index.js",
    connectionFields: [
      {
        id: "serverUrl",
        label: "Server",
        type: "url",
        required: true,
        defaultValue: "https://github.com",
      },
      {
        id: "token",
        label: "Token",
        type: "password",
        required: true,
        secret: true,
      },
    ],
    capabilities: { connector: {}, codeHost: {} },
    network: {
      auth: { scheme: "bearer", secretField: "token" },
      baseAddress: { field: "serverUrl", allowOnPremises: true },
      derivedHosts: [
        {
          id: "rest",
          forms: [
            { whenHost: "github.com", host: "api.github.com" },
            { host: "{host}", pathPrefix: "/api/v3" },
          ],
          endpoints: [{ method: "GET", path: "/repos/*/*/activity" }],
        },
        {
          id: "graphql",
          forms: [
            { whenHost: "github.com", host: "api.github.com" },
            { host: "{host}", pathPrefix: "/api" },
          ],
          endpoints: [{ method: "POST", path: "/graphql" }],
        },
      ],
      requestHeaders: ["Accept", "Content-Type", "X-GitHub-Api-Version"],
      publicHosts: ["avatars.githubusercontent.com"],
    },
  };
}

export function jiraManifest(): Fixture {
  return {
    id: "ajc-jira",
    version: "4.0.0",
    apiVersion: 4,
    displayName: "Jira",
    iconSvg: ICON,
    entrypoint: "dist/index.js",
    connectionFields: [
      { id: "baseUrl", label: "Site URL", type: "url", required: true },
      { id: "email", label: "Email", type: "text", required: true },
      {
        id: "apiToken",
        label: "API token",
        type: "password",
        required: true,
        secret: true,
      },
    ],
    capabilities: { connector: { settle: true, description: { write: true } } },
    network: {
      auth: { scheme: "basic", userField: "email", secretField: "apiToken" },
      baseAddress: { field: "baseUrl" },
      endpoints: [
        { method: "GET", path: "/rest/api/3/myself" },
        { method: "POST", path: "/rest/api/3/search/jql" },
        { method: "PUT", path: "/rest/api/3/issue/*" },
        { method: "POST", path: "/rest/api/3/issue/*/transitions" },
      ],
      requestHeaders: ["Accept", "Content-Type"],
    },
    runtime: { start: "whenNeeded" },
  };
}

export function icsManifest(): Fixture {
  return {
    id: "ajc-ics",
    version: "4.0.0",
    apiVersion: 4,
    displayName: "ICS calendar",
    iconSvg: ICON,
    entrypoint: "dist/index.js",
    connectionFields: [
      {
        id: "feedUrl",
        label: "Secret address",
        type: "url",
        required: true,
        secret: true,
      },
    ],
    capabilities: { calendar: {} },
    network: { auth: { scheme: "secretAddress", secretField: "feedUrl" } },
  };
}

export function workdayShapeManifest(): Fixture {
  return {
    id: "ajp-workday",
    version: "4.0.0",
    apiVersion: 4,
    displayName: "Workday",
    iconSvg: ICON,
    entrypoint: "dist/index.js",
    capabilities: {
      projectDataShape: {
        apiVersion: 1,
        datasets: [
          {
            id: "projects",
            displayName: "Projects",
            columns: [
              { key: "name", header: "Project", type: "string" },
              { key: "code", header: "Code", type: "string" },
            ],
          },
        ],
      },
    },
  };
}

export function workdayAgentManifest(): Fixture {
  return {
    id: "ajp-workday-agent",
    version: "4.0.0",
    apiVersion: 4,
    displayName: "Workday tasks",
    iconSvg: ICON,
    capabilities: {
      agentTask: {
        tasks: [
          {
            id: "enter-week",
            label: "Enter in Workday",
            placement: "commit-week",
            prompt: "prompts/enter-week.md",
            estimateMinutes: 5,
            tools: ["get_week_changes", "get_week_status"],
            settings: [
              { id: "url", label: "Workday URL", type: "url", required: true },
            ],
          },
          {
            id: "submit-week",
            label: "Submit in Workday",
            placement: "submit-week",
            prompt: "prompts/submit-week.md",
            estimateMinutes: 2,
            tools: ["get_week_status", "submit_week"],
          },
        ],
      },
      projectProperties: {
        section: "Workday",
        fields: [{ id: "workday-project", label: "Workday project" }],
      },
    },
    runtime: { start: "alwaysReady", memoryCeilingMb: 128 },
  };
}
