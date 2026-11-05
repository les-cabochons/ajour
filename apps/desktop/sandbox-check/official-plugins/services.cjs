// The fixture services of the release check: the parts of Jira, GitHub, Azure
// DevOps and a calendar server the six official plugins call. Each one
// answers only a request that carries the credential the broker should have
// attached, and keeps what a request changed, so a case can read it back.
"use strict";

const JIRA = {
  host: "acme.atlassian.net",
  email: "me@acme.test",
  token: "jira-token-4f1a9c",
};
const GITHUB = { token: "github_pat_5c0ffee9d1" };
const AZURE = { organization: "contoso", token: "ado-pat-77c2e5a0" };

const basic = (user, secret) =>
  `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;

const json = (body, status = 200) => ({ status, json: body });

// ---------------------------------------------------------------- Jira

function createJira() {
  const state = { issues: new Map(), requests: [] };
  state.issues.set("ENG-1", {
    id: "10001",
    key: "ENG-1",
    fields: {
      summary: "Investigate incident",
      status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
      issuetype: { name: "Task", subtask: false },
      priority: { name: "High" },
      project: { name: "Platform" },
    },
  });
  const handler = (request) => {
    state.requests.push(`${request.method} ${request.path}`);
    if (request.headers.authorization !== basic(JIRA.email, JIRA.token)) {
      return json({ errorMessages: ["Client must be authenticated."] }, 401);
    }
    if (request.path === "/rest/api/3/myself") {
      return json({ accountId: "abc123" });
    }
    if (request.path === "/rest/api/3/field") return json([]);
    if (request.path.startsWith("/rest/api/3/search")) {
      return json({ issues: [...state.issues.values()] });
    }
    return json({ errorMessages: [`No fixture for ${request.path}`] }, 404);
  };
  return { state, handler };
}

// -------------------------------------------------------------- GitHub

function createGitHub() {
  const issues = new Map([
    [
      7,
      {
        id: "I_7",
        title: "Rate limit the API",
        body: "Use a token bucket.",
        state: "OPEN",
        stateReason: null,
      },
    ],
  ]);
  const viewer = {
    __typename: "User",
    login: "octocat",
    name: "The Octocat",
    avatarUrl: "https://example.test/a.png",
  };
  const alice = {
    __typename: "User",
    login: "alice",
    avatarUrl: "https://example.test/b.png",
  };
  const state = { issues, requests: [], closed: [] };
  const issue = (number) => {
    const record = issues.get(number);
    return {
      id: record.id,
      number,
      url: `https://github.com/acme/api/issues/${number}`,
      title: record.title,
      body: record.body,
      state: record.state,
      stateReason: record.stateReason,
      repository: { nameWithOwner: "acme/api" },
      assignees: { nodes: [{ login: "octocat" }] },
    };
  };
  const pullRequest = () => ({
    id: "PR_1",
    number: 1,
    url: "https://github.com/acme/api/pull/1",
    title: "Add rate limits",
    isDraft: false,
    state: "OPEN",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    closedAt: null,
    headRefOid: "abc123",
    headRefName: "change/rate-limits",
    headRepository: { nameWithOwner: "alice/api" },
    mergeable: "MERGEABLE",
    repository: { nameWithOwner: "acme/api" },
    author: alice,
    commits: {
      nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }],
    },
    timelineItems: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviews: {
      nodes: [
        {
          id: "R_1",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-10-01T13:00:00Z",
          body: "",
          author: viewer,
        },
      ],
    },
    comments: { nodes: [] },
    reviewThreads: { nodes: [] },
  });
  const search = (nodes) => ({
    search: {
      issueCount: nodes.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes,
    },
  });
  const graphql = (body) => {
    const { query, variables } = body;
    if (query.includes("closeIssue")) {
      const entry = [...issues.values()].find((i) => i.id === variables.id);
      entry.state = "CLOSED";
      entry.stateReason = variables.reason;
      state.closed.push(variables.id);
      return { closeIssue: { issue: issue(7) } };
    }
    if (query.includes("organizations")) {
      return {
        viewer: {
          organizations: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        },
      };
    }
    if (query.includes("search(")) {
      if (query.includes("... on PullRequest")) {
        return search(
          String(variables.q).includes("reviewed-by") ? [pullRequest()] : [],
        );
      }
      return search(
        [...issues.keys()]
          .filter((n) => issues.get(n).state === "OPEN")
          .map(issue),
      );
    }
    if (query.includes("repository(")) {
      return { repository: { issue: issue(variables.number ?? 7) } };
    }
    return { viewer };
  };
  /** `api.github.com`: GitHub.com's REST and GraphQL API. */
  const api = (request) => {
    state.requests.push(`${request.method} ${request.path}`);
    if (request.headers.authorization !== `Bearer ${GITHUB.token}`) {
      return json({ message: "Bad credentials" }, 401);
    }
    if (request.path === "/graphql" && request.method === "POST") {
      return json({ data: graphql(JSON.parse(request.body)) });
    }
    if (request.path === "/repos/alice/api/activity") {
      return json([
        {
          after: "abc123",
          ref: request.query.get("ref"),
          activity_type: "push",
          timestamp: "2026-10-02T10:00:00Z",
          actor: { login: "octocat", type: "User" },
        },
      ]);
    }
    return json({ message: "Not Found" }, 404);
  };
  return { state, api };
}

// --------------------------------------------------------- Azure DevOps

const AZURE_VIEWER = "11111111-1111-1111-1111-111111111111";
const ALBA = "44444444-4444-4444-4444-444444444444";
const PROJECT = "Mercury";
const PROJECT_ID = "99999999-9999-9999-9999-999999999999";
const ORIGINAL_ESTIMATE = "Microsoft.VSTS.Scheduling.OriginalEstimate";

function createAzure() {
  const viewer = {
    id: AZURE_VIEWER,
    displayName: "Ada Lovelace",
    uniqueName: "ada@contoso.com",
  };
  const alba = {
    id: ALBA,
    displayName: "Alba Reyes",
    uniqueName: "alba@contoso.com",
  };
  const items = new Map([
    [
      42,
      {
        id: 42,
        rev: 3,
        fields: {
          "System.Title": "Fix login",
          "System.State": "Active",
          "System.TeamProject": PROJECT,
          "System.WorkItemType": "Task",
          "System.AssignedTo": viewer,
          "System.CreatedBy": alba,
          "System.ChangedDate": "2026-10-20T10:00:00Z",
          "System.Description": "<div>Steps for <b>login</b></div>",
          [ORIGINAL_ESTIMATE]: 4,
        },
      },
    ],
  ]);
  const comments = new Map([
    [
      42,
      [
        {
          id: 1,
          text: "Can you look?",
          format: "markdown",
          createdBy: alba,
          createdDate: "2026-10-21T09:00:00Z",
          reactions: [],
        },
      ],
    ],
  ]);
  const states = [
    { name: "New", category: "Proposed" },
    { name: "Active", category: "InProgress" },
    { name: "Resolved", category: "Resolved" },
    { name: "Closed", category: "Completed" },
  ];
  const fields = [
    {
      name: "Original Estimate",
      referenceName: ORIGINAL_ESTIMATE,
      type: "double",
      isQueryable: true,
    },
    {
      name: "Priority",
      referenceName: "Microsoft.VSTS.Common.Priority",
      type: "integer",
      isQueryable: true,
    },
  ];
  const pullRequest = {
    pullRequestId: 12,
    status: "active",
    title: "Rate limits",
    creationDate: "2026-10-01T10:00:00Z",
    createdBy: alba,
    reviewers: [{ ...viewer, vote: 0 }],
    mergeStatus: "succeeded",
    lastMergeSourceCommit: { commitId: "abc123" },
    repository: {
      id: "repo-1",
      name: "api",
      project: { id: PROJECT_ID, name: PROJECT },
    },
  };
  const state = { items, comments, requests: [], nextCommentId: 100 };

  const workItem = (item, names) => ({
    id: item.id,
    rev: item.rev,
    fields: names
      ? Object.fromEntries(
          Object.entries(item.fields).filter(([name]) => names.includes(name)),
        )
      : item.fields,
    ...(names ? {} : { multilineFieldsFormat: {} }),
  });

  /** One request, by its path under the organization. */
  const answer = (method, path, query, body, identities) => {
    if (identities) {
      if (method === "GET" && path === "/_apis/identities") {
        const filter = (query.get("filterValue") ?? "").toLowerCase();
        return json({
          value: [
            { id: ALBA, providerDisplayName: "Alba Reyes", properties: {} },
            {
              id: "66666666-6666-6666-6666-666666666666",
              providerDisplayName: "Alan Turing",
              properties: {},
            },
          ].filter((i) =>
            i.providerDisplayName.toLowerCase().startsWith(filter),
          ),
        });
      }
      return json({ message: "Not found" }, 404);
    }
    if (method === "GET" && path === "/_apis/connectionData") {
      return json({
        authenticatedUser: {
          id: AZURE_VIEWER,
          providerDisplayName: "Ada Lovelace",
          properties: { Account: { $value: "ada@contoso.com" } },
        },
      });
    }
    if (method === "GET" && path === "/_apis/wit/fields") {
      return json({ value: fields });
    }
    if (method === "POST" && /^(\/[^/]+)?\/_apis\/wit\/wiql$/.test(path)) {
      return json({ workItems: [...items.keys()].map((id) => ({ id })) });
    }
    if (method === "POST" && path === "/_apis/wit/workitemsbatch") {
      const batch = JSON.parse(body || "{}");
      return json({
        value: batch.ids
          .filter((id) => items.has(id))
          .map((id) => workItem(items.get(id), batch.fields)),
      });
    }
    const one = /^\/_apis\/wit\/workitems\/(\d+)$/.exec(path);
    if (one) {
      const item = items.get(Number(one[1]));
      if (!item) return json({ message: "Not found" }, 404);
      if (method === "GET") {
        return json(workItem(item, query.get("fields")?.split(",")));
      }
      if (method === "PATCH") {
        for (const operation of JSON.parse(body || "[]")) {
          if (operation.op === "test" && operation.path === "/rev") {
            if (operation.value !== item.rev) {
              return json(
                { message: "TF26071: changed by someone else." },
                412,
              );
            }
          }
          if (operation.op === "add" && operation.path.startsWith("/fields/")) {
            item.fields[operation.path.slice("/fields/".length)] =
              operation.value;
          }
        }
        item.rev += 1;
        return json(workItem(item));
      }
    }
    const type =
      /^\/[^/]+\/_apis\/wit\/workitemtypes\/([^/]+)\/(states|fields)$/.exec(
        path,
      );
    if (type && method === "GET") {
      return json({ value: type[2] === "states" ? states : fields });
    }
    const comment =
      /^\/[^/]+\/_apis\/wit\/workItems\/(\d+)\/comments(?:\/(\d+))?$/.exec(
        path,
      );
    if (comment) {
      const list = comments.get(Number(comment[1])) ?? [];
      comments.set(Number(comment[1]), list);
      const render = (c) => ({ ...c, renderedText: c.text });
      if (!comment[2] && method === "GET") {
        return json({
          totalCount: list.length,
          count: list.length,
          comments: [...list].reverse().map(render),
        });
      }
      if (!comment[2] && method === "POST") {
        const created = {
          id: state.nextCommentId++,
          text: JSON.parse(body || "{}").text,
          format: query.get("format") === "markdown" ? "markdown" : "html",
          createdBy: viewer,
          createdDate: "2026-10-25T12:00:00Z",
          reactions: [],
        };
        list.push(created);
        return json(render(created));
      }
    }
    if (method === "GET" && path === "/_apis/teams") return json({ value: [] });
    if (method === "GET" && path === "/_apis/git/repositories") {
      return json({ value: [{ id: "repo-1", project: { id: PROJECT_ID } }] });
    }
    if (method === "GET" && path === "/_apis/git/pullrequests") {
      return json({
        value:
          query.get("searchCriteria.reviewerId") === AZURE_VIEWER
            ? [pullRequest]
            : [],
      });
    }
    if (method === "GET" && path === "/_apis/git/pullrequests/12") {
      return json(pullRequest);
    }
    const detail = new RegExp(
      `^/${PROJECT_ID}/_apis/git/repositories/repo-1/pullRequests/12/(threads|iterations)$`,
    ).exec(path);
    if (detail && method === "GET") {
      return json({
        value:
          detail[1] === "threads"
            ? [
                {
                  id: 3,
                  publishedDate: "2026-10-02T10:00:00Z",
                  comments: [
                    {
                      id: 1,
                      author: alba,
                      commentType: "text",
                      publishedDate: "2026-10-02T10:00:00Z",
                      content: `@<${AZURE_VIEWER}> ready`,
                    },
                  ],
                },
              ]
            : [
                {
                  id: 1,
                  createdDate: "2026-10-02T09:00:00Z",
                  author: alba,
                  sourceRefCommit: { commitId: "abc123" },
                },
              ],
      });
    }
    if (
      method === "GET" &&
      path === `/${PROJECT_ID}/_apis/policy/evaluations`
    ) {
      return json({
        value: [
          {
            status: "approved",
            configuration: {
              type: { id: "0609b952-1397-4640-95ec-e00a01b2c241" },
            },
          },
        ],
      });
    }
    return json({ message: `No fixture answers ${method} ${path}.` }, 404);
  };

  /** A host of the organization: dev.azure.com, or its identities host. */
  const host = (identities) => (request) => {
    state.requests.push(
      `${identities ? "identities " : ""}${request.method} ${request.path}`,
    );
    if (request.headers.authorization !== basic("", AZURE.token)) {
      return { status: 203, body: "<html>Sign in</html>" };
    }
    const root = `/${AZURE.organization}`;
    if (!request.path.startsWith(`${root}/`)) {
      return json(
        { message: `Outside the organization: ${request.path}` },
        404,
      );
    }
    return answer(
      request.method,
      request.path.slice(root.length),
      request.query,
      request.body,
      identities,
    );
  };
  return { state, host: host(false), identities: host(true) };
}

// ------------------------------------------------------------ Calendar

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Fixture//Ajour release check//EN",
  "X-WR-CALNAME:Fixture calendar",
  "BEGIN:VEVENT",
  "UID:fixture-event-1",
  "DTSTAMP:20261101T000000Z",
  "DTSTART:20261102T140000Z",
  "DTEND:20261102T150000Z",
  "SUMMARY:Fixture meeting",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

module.exports = {
  JIRA,
  GITHUB,
  AZURE,
  PROJECT,
  ORIGINAL_ESTIMATE,
  FEED,
  createJira,
  createGitHub,
  createAzure,
};
