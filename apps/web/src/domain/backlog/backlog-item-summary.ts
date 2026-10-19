import type { LocalWorkItem, LocalWorkflowState } from "@/domain/local-state";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  getDirectChildWorkItems,
  getWorkItemLookupKeys,
  getWorkItemParentKey,
} from "./work-item-hierarchy";

/**
 * Where a synced backlog item lives in its source tool, such as the
 * "les-cabochons" organization and the "ajour" project.
 */
export interface WorkItemOrigin {
  organization?: string;
  project?: string;
}

/** What the sidebar's hover card shows about a backlog item. */
export interface BacklogItemSummary {
  /** The item's id as people write it in its source tool: "1234" or "ABC-12". */
  key?: string;
  origin?: WorkItemOrigin;
  parent?: LocalWorkItem;
  /** Open subitems first, then closed ones, up to the limit. */
  subitems: {
    workItem: LocalWorkItem;
    workflowState?: LocalWorkflowState;
    closed: boolean;
  }[];
  subitemCount: number;
  closedSubitemCount: number;
  /** Open pull requests first, then the most recently updated, up to the limit. */
  pullRequests: LocalPullRequest[];
  pullRequestCount: number;
}

export const SUMMARY_SUBITEM_LIMIT = 8;
export const SUMMARY_PULL_REQUEST_LIMIT = 5;

/** Path segments that name the kind of object in a repository URL, as in /owner/repo/issues/12. */
const REPOSITORY_KINDS = new Set([
  "issues",
  "pull",
  "pulls",
  "merge_requests",
  "work_items",
]);
/** Azure DevOps areas of a project, as in /org/project/_workitems/edit/12. */
const AZURE_AREAS = new Set(["_workitems", "_git"]);
/** Hosts whose first label is the organization, as in acme.atlassian.net. */
const ORGANIZATION_SUBDOMAINS = [".atlassian.net", ".visualstudio.com"];
const JIRA_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
/** The key at the end of a plugin's external id: "1234", "acme/api#12" or "PAY-12". */
const EXTERNAL_ID_KEY =
  /(?:^|#)(\d+)$|(?:^|[^A-Za-z0-9_])([A-Z][A-Z0-9_]+-\d+)$/;

interface SourceLocation {
  organization: string;
  project?: string;
  /**
   * Where a number such as "#12" names one item: a repository on GitHub, an
   * organization on Azure DevOps, where every project shares the numbers.
   */
  numberScope?: string;
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function locate(value: string | undefined): SourceLocation | undefined {
  const url = parseUrl(value);
  if (!url) return undefined;
  const host = url.hostname.toLowerCase();
  // GitLab puts "-" between the project and the object kind.
  const segments = url.pathname
    .split("/")
    .filter((segment) => segment && segment !== "-")
    .map(decodeSegment);
  const scope = (count: number) =>
    [host, ...segments.slice(0, count)].join("/").toLowerCase();
  const site = ORGANIZATION_SUBDOMAINS.some((suffix) => host.endsWith(suffix))
    ? host.split(".")[0]!
    : host;

  // GitHub and GitLab: /owner/repo/issues/12 or /owner/repo/pull/3. The
  // number after the kind tells it from a repository named "issues".
  const kind = segments.findIndex(
    (segment, index) =>
      index >= 2 &&
      REPOSITORY_KINDS.has(segment) &&
      /^\d+$/.test(segments[index + 1] ?? ""),
  );
  if (kind >= 2) {
    return {
      organization: segments[0]!,
      project: segments.slice(1, kind).join("/"),
      numberScope: scope(kind),
    };
  }

  // Azure DevOps: /org/project/_workitems/edit/12 or /org/project/_git/repo/pullrequest/3.
  const area = segments.findIndex(
    (segment, index) => index >= 1 && AZURE_AREAS.has(segment),
  );
  if (area >= 1) {
    const project = segments[area - 1];
    // Azure DevOps Services names one organization two ways, dev.azure.com/org
    // and the older org.visualstudio.com, with or without its collection.
    const cloud =
      host === "dev.azure.com"
        ? segments[0]
        : host.endsWith(".visualstudio.com")
          ? host.split(".")[0]
          : undefined;
    if (cloud) {
      return {
        organization: cloud,
        project,
        numberScope: `azure-devops/${cloud.toLowerCase()}`,
      };
    }
    // Azure DevOps Server: the collection shares the numbers.
    return {
      organization: area >= 2 ? segments[area - 2]! : host,
      project,
      numberScope: scope(area - 1),
    };
  }

  // Jira and the rest: the site names the organization.
  return { organization: site };
}

function locateWorkItem(workItem: LocalWorkItem) {
  return locate(workItem.sourceUrl) ?? locate(workItem.sourceId);
}

function lastSegment(value: string | undefined) {
  if (!value) return undefined;
  const path = parseUrl(value)?.pathname ?? value;
  return path.split("/").filter(Boolean).at(-1);
}

/**
 * The item's id as people write it in its source tool: "1234" or "ABC-12".
 * The plugin's external id says it; items synced before Ajour kept that id
 * fall back to the end of their link.
 */
export function getWorkItemKey(workItem: LocalWorkItem) {
  if (workItem.source === "manual") return undefined;
  const external = workItem.sourceExternalId?.match(EXTERNAL_ID_KEY);
  if (external) return external[1] ?? external[2];
  for (const value of [workItem.sourceUrl, workItem.sourceId]) {
    const segment = lastSegment(value);
    if (segment && (/^\d+$/.test(segment) || JIRA_KEY.test(segment))) {
      return segment;
    }
  }
  return undefined;
}

/**
 * The organization and project a synced item comes from, read from its link.
 * Without a link, the connection's label stands for the organization.
 */
export function getWorkItemOrigin(
  workItem: LocalWorkItem,
): WorkItemOrigin | undefined {
  if (workItem.source === "manual") return undefined;
  const location = locateWorkItem(workItem);
  const organization = location?.organization ?? workItem.sourceConnectionLabel;
  let project = location?.project ?? workItem.sourceProjectName;
  // A GitHub repository's full name repeats its owner.
  if (organization && project?.startsWith(`${organization}/`)) {
    project = project.slice(organization.length + 1);
  }
  if (!organization && !project) return undefined;
  return { organization, project };
}

/**
 * The pull requests whose title names the item. A key such as "ABC-12" names
 * it anywhere. A number such as "#12" names it only in a pull request from the
 * same repository, or on Azure DevOps the same organization. Code hosts do not
 * report links to backlog items, so the title is what Ajour has to go on.
 */
export function findPullRequestsNamingItem(
  workItem: LocalWorkItem,
  pullRequests: readonly LocalPullRequest[],
) {
  const key = getWorkItemKey(workItem);
  if (!key) return [];
  if (JIRA_KEY.test(key)) {
    // A letter, digit or underscore on either side makes another key, as in
    // TEAM_PAY-12 or PAY-12abc.
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${key}(?![A-Za-z0-9_])`, "i");
    return pullRequests.filter((item) => pattern.test(item.facts.title));
  }

  const scope = locateWorkItem(workItem)?.numberScope;
  if (!scope) return [];
  const pattern = new RegExp(`(?<![\\w#])#${key}(?!\\w)`);
  return pullRequests.filter(
    (item) =>
      pattern.test(item.facts.title) &&
      locate(item.facts.url)?.numberScope === scope,
  );
}

function findParent(
  workItem: LocalWorkItem,
  workItems: readonly LocalWorkItem[],
) {
  const key = getWorkItemParentKey(workItem);
  return key
    ? workItems.find((candidate) =>
        getWorkItemLookupKeys(candidate).includes(key),
      )
    : undefined;
}

export function summarizeBacklogItem(
  workItem: LocalWorkItem,
  context: {
    workItems: readonly LocalWorkItem[];
    workflowStates: readonly LocalWorkflowState[];
    /** The pull requests the user can see now. */
    pullRequests: readonly LocalPullRequest[];
  },
): BacklogItemSummary {
  const children = getDirectChildWorkItems(workItem, context.workItems);
  const closed = (child: LocalWorkItem) => child.status === "archived";
  const subitems = [
    ...children.filter((child) => !closed(child)),
    ...children.filter(closed),
  ];
  const pullRequests = findPullRequestsNamingItem(
    workItem,
    context.pullRequests,
  ).sort(
    (left, right) =>
      Number(right.facts.state === "open") -
        Number(left.facts.state === "open") ||
      right.facts.updatedAt - left.facts.updatedAt,
  );

  return {
    key: getWorkItemKey(workItem),
    origin: getWorkItemOrigin(workItem),
    parent: findParent(workItem, context.workItems),
    subitems: subitems.slice(0, SUMMARY_SUBITEM_LIMIT).map((child) => ({
      workItem: child,
      workflowState: child.workflowStateId
        ? context.workflowStates.find(
            (status) => status._id === child.workflowStateId,
          )
        : undefined,
      closed: closed(child),
    })),
    subitemCount: subitems.length,
    closedSubitemCount: children.filter(closed).length,
    pullRequests: pullRequests.slice(0, SUMMARY_PULL_REQUEST_LIMIT),
    pullRequestCount: pullRequests.length,
  };
}
