import { describe, expect, it } from "vitest";
import type { CodeHostPullRequestFacts } from "@ajour/shared";
import {
  findPullRequestsNamingItem,
  getWorkItemKey,
  getWorkItemOrigin,
  SUMMARY_SUBITEM_LIMIT,
  summarizeBacklogItem,
} from "./backlog-item-summary";
import type { LocalWorkItem } from "@/domain/local-state";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";

const item = (
  _id: string,
  patch: Partial<LocalWorkItem> = {},
): LocalWorkItem => ({
  _id,
  title: _id,
  status: "active",
  source: "manual",
  createdAt: 1,
  ...patch,
});

const issue = item("issue", {
  source: "github",
  sourceId: "https://github.com/les-cabochons/ajour/issues/288",
  sourceUrl: "https://github.com/les-cabochons/ajour/issues/288",
  sourceProjectName: "les-cabochons/ajour",
  sourceConnectionLabel: "Personal",
});
const workItem = item("work-item", {
  source: "azure_devops",
  sourceId: "https://dev.azure.com/acme/Web%20App/_workitems/edit/1234",
  sourceUrl: "https://dev.azure.com/acme/Web%20App/_workitems/edit/1234",
  sourceProjectName: "Web App",
});
const jiraIssue = item("jira-issue", {
  source: "jira",
  sourceId: "https://acme.atlassian.net/browse/PAY-12",
  sourceUrl: "https://acme.atlassian.net/browse/PAY-12",
  sourceProjectName: "Payments",
});

let nextId = 0;
function pullRequest(
  url: string,
  title: string,
  facts: Partial<CodeHostPullRequestFacts> = {},
): LocalPullRequest {
  nextId += 1;
  return {
    _id: `pr${nextId}`,
    pluginId: "github",
    pluginName: "GitHub",
    connectionId: "work",
    connectionLabel: "Work",
    viewerLogin: "alex",
    status: "active",
    activeAt: 1,
    missingFromSync: false,
    facts: {
      id: `pr${nextId}`,
      repository: "acme/api",
      number: nextId,
      url,
      title,
      author: { login: "alex", isBot: false },
      viewerIsAuthor: true,
      state: "open",
      draft: false,
      headSha: "sha",
      lastPushedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      reviewRequests: [],
      reviews: [],
      comments: [],
      checks: "success",
      mergeability: "mergeable",
      ...facts,
    },
  };
}

describe("where a backlog item comes from", () => {
  it("reads the owner and repository of a GitHub issue", () => {
    expect(getWorkItemOrigin(issue)).toEqual({
      organization: "les-cabochons",
      project: "ajour",
    });
    expect(getWorkItemKey(issue)).toBe("288");
  });

  it("reads the organization and project of an Azure DevOps work item", () => {
    expect(getWorkItemOrigin(workItem)).toEqual({
      organization: "acme",
      project: "Web App",
    });
    expect(
      getWorkItemOrigin(
        item("old", {
          source: "azure_devops",
          sourceUrl: "https://acme.visualstudio.com/Web/_workitems/edit/5",
        }),
      ),
    ).toEqual({ organization: "acme", project: "Web" });
    expect(getWorkItemKey(workItem)).toBe("1234");
  });

  it("reads the Jira site and keeps the source project", () => {
    expect(getWorkItemOrigin(jiraIssue)).toEqual({
      organization: "acme",
      project: "Payments",
    });
    expect(getWorkItemKey(jiraIssue)).toBe("PAY-12");
    expect(
      getWorkItemOrigin(
        item("server", {
          source: "jira",
          sourceUrl: "https://jira.acme.com/browse/PAY-12",
        }),
      ),
    ).toEqual({ organization: "jira.acme.com", project: undefined });
  });

  it("keeps a GitHub repository whose name looks like an Azure DevOps area", () => {
    expect(
      getWorkItemOrigin(
        item("underscore", {
          source: "github",
          sourceUrl: "https://github.com/acme/_infra/issues/12",
        }),
      ),
    ).toEqual({ organization: "acme", project: "_infra" });
    expect(
      getWorkItemOrigin(
        item("issues-repo", {
          source: "github",
          sourceUrl: "https://github.com/acme/issues/issues/12",
        }),
      ),
    ).toEqual({ organization: "acme", project: "issues" });
    expect(
      getWorkItemOrigin(
        item("server", {
          source: "azure_devops",
          sourceUrl:
            "https://tfs.acme.com/tfs/Main/Web%20App/_workitems/edit/12",
        }),
      ),
    ).toEqual({ organization: "Main", project: "Web App" });
  });

  it("falls back to the connection without a link", () => {
    expect(
      getWorkItemOrigin(
        item("linkless", {
          source: "github",
          sourceId: "opaque",
          sourceConnectionLabel: "Work",
          sourceProjectName: "acme/api",
        }),
      ),
    ).toEqual({ organization: "Work", project: "acme/api" });
  });

  it("has no origin or key for a manual item", () => {
    expect(getWorkItemOrigin(item("manual"))).toBeUndefined();
    expect(getWorkItemKey(item("manual", { sourceId: "12" }))).toBeUndefined();
  });
});

describe("pull requests that name a backlog item", () => {
  it("matches a number only in the same repository", () => {
    const same = pullRequest(
      "https://github.com/les-cabochons/ajour/pull/293",
      "feat(backlog): a people picker (#288)",
    );
    const otherRepository = pullRequest(
      "https://github.com/les-cabochons/review-deck/pull/4",
      "Fix #288",
    );
    const longerNumber = pullRequest(
      "https://github.com/les-cabochons/ajour/pull/300",
      "Fix #2880",
    );
    const boardsMention = pullRequest(
      "https://github.com/les-cabochons/ajour/pull/301",
      "Fix AB#288",
    );
    expect(
      findPullRequestsNamingItem(issue, [
        same,
        otherRepository,
        longerNumber,
        boardsMention,
      ]),
    ).toEqual([same]);
  });

  it("keeps a number to its repository when the name starts with an underscore", () => {
    const infraIssue = item("infra", {
      source: "github",
      sourceUrl: "https://github.com/acme/_infra/issues/12",
    });
    const same = pullRequest(
      "https://github.com/acme/_infra/pull/3",
      "Fix #12",
    );
    const other = pullRequest(
      "https://github.com/other/_tools/pull/3",
      "Fix #12",
    );
    expect(findPullRequestsNamingItem(infraIssue, [same, other])).toEqual([
      same,
    ]);
  });

  it("matches a number anywhere in the same Azure DevOps organization", () => {
    const otherProject = pullRequest(
      "https://dev.azure.com/acme/Platform/_git/api/pullrequest/9",
      "#1234 retry the export",
    );
    const otherOrganization = pullRequest(
      "https://dev.azure.com/globex/Web%20App/_git/web/pullrequest/9",
      "#1234 retry the export",
    );
    expect(
      findPullRequestsNamingItem(workItem, [otherProject, otherOrganization]),
    ).toEqual([otherProject]);
  });

  it("matches a key in any repository, whatever its case", () => {
    const named = pullRequest(
      "https://github.com/acme/api/pull/1",
      "pay-12: round totals",
    );
    const longer = pullRequest(
      "https://github.com/acme/api/pull/2",
      "PAY-123: round totals",
    );
    const prefixed = pullRequest(
      "https://github.com/acme/api/pull/3",
      "XPAY-12: round totals",
    );
    const underscored = pullRequest(
      "https://github.com/acme/api/pull/4",
      "Fix TEAM_PAY-12",
    );
    expect(
      findPullRequestsNamingItem(jiraIssue, [
        named,
        longer,
        prefixed,
        underscored,
      ]),
    ).toEqual([named]);
  });

  it("matches nothing for a manual item", () => {
    expect(
      findPullRequestsNamingItem(item("manual"), [
        pullRequest("https://github.com/acme/api/pull/1", "#1"),
      ]),
    ).toEqual([]);
  });
});

describe("backlog item summary", () => {
  it("lists open subitems first, up to the limit, and counts them all", () => {
    const parent = item("parent");
    const children = Array.from(
      { length: SUMMARY_SUBITEM_LIMIT + 2 },
      (_, index) =>
        item(`child${index}`, {
          parentWorkItemId: "parent",
          createdAt: index,
          status: index < 2 ? "archived" : "active",
          workflowStateId: "todo",
        }),
    );
    const summary = summarizeBacklogItem(parent, {
      workItems: [parent, ...children],
      workflowStates: [
        { _id: "todo", name: "To do", color: "#000000", createdAt: 1 },
      ],
      pullRequests: [],
    });

    expect(summary.subitemCount).toBe(SUMMARY_SUBITEM_LIMIT + 2);
    expect(summary.closedSubitemCount).toBe(2);
    expect(summary.subitems).toHaveLength(SUMMARY_SUBITEM_LIMIT);
    expect(summary.subitems.every((subitem) => !subitem.closed)).toBe(true);
    expect(summary.subitems[0]?.workflowState?.name).toBe("To do");
  });

  it("names a subitem's parent", () => {
    const parent = item("parent");
    const child = item("child", { parentWorkItemId: "parent" });
    const summary = summarizeBacklogItem(child, {
      workItems: [parent, child],
      workflowStates: [],
      pullRequests: [],
    });
    expect(summary.parent).toBe(parent);
    expect(summary.subitemCount).toBe(0);
  });

  it("puts open pull requests first, then the latest", () => {
    const url = "https://github.com/les-cabochons/ajour/pull/1";
    const merged = pullRequest(url, "Old (#288)", {
      state: "merged",
      updatedAt: 9,
    });
    const older = pullRequest(url, "First (#288)", { updatedAt: 2 });
    const newer = pullRequest(url, "Second (#288)", { updatedAt: 5 });
    const summary = summarizeBacklogItem(issue, {
      workItems: [issue],
      workflowStates: [],
      pullRequests: [merged, older, newer],
    });
    expect(summary.pullRequests).toEqual([newer, older, merged]);
    expect(summary.pullRequestCount).toBe(3);
    expect(summary.key).toBe("288");
  });
});
