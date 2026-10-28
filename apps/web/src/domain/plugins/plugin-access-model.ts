import type {
  PluginAccessActivity,
  PluginAccessDerivedHost,
  PluginAccessDifference,
  PluginAccessEndpoint,
  PluginAccessView,
  PluginOverviewGroup,
} from "@ajour/shared";

/**
 * What a plugin page says about the access a plugin has, in plain words. The
 * API sends the manifest's facts (`PluginAccessView`) and, for an update that
 * needs consent, only what is new (`PluginAccessDifference`). This turns them
 * into the lines the Access section and the consent panel list, so both say
 * the same thing and a line is New in one place only.
 */

export type AccessItemKind =
  "capability" | "network" | "credential" | "agent" | "runtime";

export interface AccessEndpointLine {
  /** Method and path, such as `GET /rest/api/3/myself`. */
  text: string;
  /** The access choice that unlocks it, when one does. */
  gate?: string;
  isNew: boolean;
}

export interface AccessItem {
  id: string;
  kind: AccessItemKind;
  title: string;
  detail: string;
  endpoints?: AccessEndpointLine[];
  /** The whole line is new. */
  isNew: boolean;
  /** The line is old but some of its endpoints are new. */
  hasNewEndpoints: boolean;
}

export interface AccessLabels {
  /** The plugin's connection fields, for naming the address and credential. */
  fields: readonly { id: string; label: string }[];
  /** The plugin's agent tasks. */
  tasks: readonly { id: string; label: string }[];
}

/** The capabilities in GLOSSARY.md's words. */
const CAPABILITY_LABELS: Record<string, string> = {
  connector: "Backlog",
  codeHost: "Code host",
  calendar: "Calendar",
  team: "Team",
  agentTask: "Agent tasks",
  projectProperties: "Project properties",
  taskProperties: "Task properties",
  projectDataShape: "Schema",
};

/**
 * What each plugin operation an access choice can unlock does, to follow
 * "lets a connection". An operation not listed is named as the plugin
 * names it.
 */
const OPERATION_LABELS: Record<string, string> = {
  validateConnection: "check its settings",
  syncConnection: "sync backlog items",
  listSettleStates: "list the states it can settle to",
  writeSettle: "settle backlog items in the source",
  readDescription: "read descriptions",
  writeDescription: "edit descriptions",
  listItemComments: "read comments",
  postItemComment: "post comments",
  editItemComment: "edit comments",
  deleteItemComment: "delete comments",
  setItemCommentReaction: "react to comments",
  searchItemPeople: "search people",
  syncPullRequests: "sync pull requests",
  getPullRequestContent: "read pull request changes",
  getFileContent: "read files",
  getPullRequestConversation: "read pull request conversations",
  browsePullRequests: "browse pull requests",
  submitReview: "submit reviews",
  postComment: "comment on pull requests",
  replyToThread: "reply to review threads",
  setThreadResolved: "resolve review threads",
  setFileViewed: "mark files as viewed",
  listCalendarEvents: "read calendar events",
  createTeam: "create teams",
  syncTeamProjects: "sync team projects",
};

function operationList(operations: readonly string[]) {
  return list(
    operations.map((operation) => OPERATION_LABELS[operation] ?? operation),
  );
}

/** About how much memory an always-ready plugin keeps (spec #381). */
export const ALWAYS_READY_MEMORY_MB = 30;

/** The plugin API that declares what a plugin reaches. */
export const FIRST_LIMITED_PLUGIN_API = 4;

/** Whether the plugin's access is limited and listed, as plugin API 4 makes it. */
export function hasListedAccess(group: PluginOverviewGroup) {
  return group.plugin.apiVersion >= FIRST_LIMITED_PLUGIN_API && !!group.access;
}

function endpointKey(endpoint: PluginAccessEndpoint) {
  return [
    endpoint.host,
    endpoint.method,
    endpoint.path,
    endpoint.access ?? "",
  ].join(" ");
}

/** Where a derived host form sends requests, in words a person can read. */
function formText(form: PluginAccessDerivedHost) {
  const exact =
    form.whenHost && !form.whenHost.startsWith("*.") ? form.whenHost : "";
  const host = form.host
    .replaceAll("{host}", exact || "<your host>")
    .replaceAll("{match}", "<your organisation>");
  return `${host}${form.pathPrefix ?? ""}`;
}

function list(values: readonly string[]) {
  return values.length <= 2
    ? values.join(" and ")
    : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

/**
 * The lines of the Access section. With `difference`, a line that is new or
 * has new endpoints says so. With `onlyNew`, only those lines are listed,
 * each with only its new endpoints, for the consent panel; `difference` is
 * then what the update adds, and the lines come from it alone.
 */
export function describeAccess(
  view: PluginAccessView,
  labels: AccessLabels,
  options: { difference?: PluginAccessDifference; onlyNew?: boolean } = {},
): AccessItem[] {
  const { summary } = view;
  const { difference, onlyNew = false } = options;
  const fieldLabel = (id: string) =>
    labels.fields.find((field) => field.id === id)?.label ?? id;
  const taskLabel = (id: string) =>
    labels.tasks.find((task) => task.id === id)?.label ?? id;
  const choiceLabel = (id: string) =>
    view.choices.find((choice) => choice.id === id)?.label ?? id;
  const newEndpoints = new Set((difference?.endpoints ?? []).map(endpointKey));

  const endpointLines = (hostId: string): AccessEndpointLine[] =>
    summary.endpoints
      .filter((endpoint) => endpoint.host === hostId)
      .map((endpoint) => ({
        text: `${endpoint.method} ${endpoint.path}`,
        ...(endpoint.access ? { gate: choiceLabel(endpoint.access) } : {}),
        isNew: newEndpoints.has(endpointKey(endpoint)),
      }));

  const items: AccessItem[] = [];
  const add = (
    item: Omit<AccessItem, "isNew" | "hasNewEndpoints"> & { isNew?: boolean },
  ) => {
    const endpoints = item.endpoints;
    const hasNewEndpoints = endpoints?.some((endpoint) => endpoint.isNew);
    const isNew = item.isNew ?? false;
    if (onlyNew && !isNew && !hasNewEndpoints) return;
    items.push({
      ...item,
      endpoints:
        onlyNew && endpoints ? endpoints.filter((e) => e.isNew) : endpoints,
      isNew,
      hasNewEndpoints: Boolean(hasNewEndpoints) && !isNew,
    });
  };

  // What the update adds to what the plugin can do.
  for (const capability of difference?.capabilities ?? []) {
    if (!onlyNew) break;
    add({
      id: `capability:${capability}`,
      kind: "capability",
      title: CAPABILITY_LABELS[capability] ?? capability,
      detail: "A feature this plugin didn't have before.",
      isNew: true,
    });
  }

  const secretAddress = summary.authSchemes.find(
    (auth) => auth.scheme === "secretAddress",
  );
  for (const host of summary.hosts) {
    if (host.kind === "secretAddress") continue;
    add({
      id: `host:${host.field}`,
      kind: "network",
      title: `The address in "${fieldLabel(host.field)}"`,
      detail: "Each connection's own address. Requests go only there.",
      endpoints: endpointLines("base"),
      isNew: (difference?.hosts ?? []).some(
        (added) => added.kind === host.kind && added.field === host.field,
      ),
    });
  }

  const derivedIds = unique(summary.derivedHosts.map((form) => form.id));
  for (const id of derivedIds) {
    const forms = summary.derivedHosts.filter((form) => form.id === id);
    add({
      id: `derived:${id}`,
      kind: "network",
      title: view.hostLabels[id] ?? id,
      detail: `Reaches ${list(unique(forms.map(formText)))}, worked out from the connection's address.`,
      endpoints: endpointLines(id),
      isNew: (difference?.derivedHosts ?? []).some((form) => form.id === id),
    });
  }

  for (const host of summary.publicHosts) {
    add({
      id: `public:${host}`,
      kind: "network",
      title: host,
      detail: "A public address. Ajour sends no credential there.",
      isNew: (difference?.publicHosts ?? []).includes(host),
    });
  }

  if (summary.onPremises) {
    add({
      id: "onPremises",
      kind: "network",
      title: "Addresses on your own network",
      detail: "Only for a connection you mark on-premises.",
      isNew: difference?.onPremises === true,
    });
  }

  const newHeaders = difference?.requestHeaders ?? [];
  const headers = onlyNew ? newHeaders : summary.requestHeaders;
  if (headers.length > 0) {
    add({
      id: "headers",
      kind: "network",
      title: "Request headers",
      detail: `It may set ${list(headers)} on its requests.`,
      isNew: newHeaders.length > 0,
    });
  }

  if (
    !onlyNew &&
    summary.hosts.length === 0 &&
    summary.derivedHosts.length === 0 &&
    summary.publicHosts.length === 0
  ) {
    add({
      id: "network:none",
      kind: "network",
      title: "No network access",
      detail: "This plugin can't reach the network.",
    });
  }

  for (const auth of summary.authSchemes) {
    const names = auth.fields.map((field) => `"${fieldLabel(field)}"`);
    add({
      id: `credential:${auth.scheme}:${auth.fields.join(",")}`,
      kind: "credential",
      title:
        auth.scheme === "secretAddress" && secretAddress
          ? `The secret address in ${names[0]}`
          : `The ${list(names)} on each connection`,
      detail:
        auth.scheme === "secretAddress"
          ? "The address is the credential. Ajour requests it itself, and the plugin never sees it."
          : "Ajour adds it to each request. The plugin never sees it.",
      isNew: (difference?.authSchemes ?? []).some(
        (added) =>
          added.scheme === auth.scheme &&
          added.fields.join(",") === auth.fields.join(","),
      ),
    });
  }
  if (!onlyNew && summary.authSchemes.length === 0) {
    add({
      id: "credential:none",
      kind: "credential",
      title: "No credential",
      detail: "Ajour sends no credential for this plugin.",
    });
  }

  const taskIds = unique([
    ...labels.tasks.map((task) => task.id),
    ...summary.mcpTools.map((entry) => entry.task),
  ]);
  for (const id of taskIds) {
    const tools = summary.mcpTools
      .filter((entry) => entry.task === id)
      .map((entry) => entry.tool);
    const newTools = (difference?.mcpTools ?? [])
      .filter((entry) => entry.task === id)
      .map((entry) => entry.tool);
    const promptChanged = (difference?.agentPrompts ?? []).includes(id);
    const parts = onlyNew
      ? [
          newTools.length > 0 ? `Can now use ${list(newTools)}.` : undefined,
          promptChanged ? "Its instructions changed." : undefined,
        ]
      : [
          tools.length > 0
            ? `Gets these Ajour tools: ${list(tools)}.`
            : "Gets no Ajour tools.",
          promptChanged ? "Its instructions changed." : undefined,
        ];
    add({
      id: `agent:${id}`,
      kind: "agent",
      title: taskLabel(id),
      detail: parts.filter(Boolean).join(" "),
      isNew: newTools.length > 0 || promptChanged,
    });
  }
  if (!onlyNew && taskIds.length === 0) {
    add({
      id: "agent:none",
      kind: "agent",
      title: "No agent tasks",
      detail: "Agents get nothing from this plugin.",
    });
  }

  // Choices a connection makes are shown on the connection; an update that
  // moves what they cover is listed only as new.
  if (onlyNew) {
    for (const choice of difference?.alwaysOnAccess ?? []) {
      add({
        id: `always:${choice}`,
        kind: "network",
        title: choiceLabel(choice),
        detail: "Now always on. It no longer waits for you to turn it on.",
        isNew: true,
      });
    }
    const byChoice = new Map<string, string[]>();
    for (const entry of difference?.accessOperations ?? []) {
      byChoice.set(entry.choice, [
        ...(byChoice.get(entry.choice) ?? []),
        entry.operation,
      ]);
    }
    for (const [choice, operations] of byChoice) {
      add({
        id: `operations:${choice}`,
        kind: "network",
        title: choiceLabel(choice),
        detail: `Now also lets a connection ${operationList(operations)}.`,
        isNew: true,
      });
    }
    // The manifest lists only gated operations, so one that left every
    // choice may run without one, or be gone.
    const ungated = difference?.ungatedOperations ?? [];
    if (ungated.length > 0) {
      const one = ungated.length === 1;
      add({
        id: "operations:ungated",
        kind: "network",
        title: `No longer behind an access choice: ${operationList(ungated)}`,
        detail: one
          ? "Either it runs without a choice now, or the update removed it."
          : "Either they run without a choice now, or the update removed them.",
        isNew: true,
      });
    }
  }

  if (!onlyNew || difference?.alwaysReady) {
    const alwaysReady = summary.startMode === "alwaysReady";
    add({
      id: "runtime",
      kind: "runtime",
      title: alwaysReady ? "Always ready" : "Loads when needed",
      detail: alwaysReady
        ? `Stays loaded in the background, using about ${ALWAYS_READY_MEMORY_MB} MB.`
        : "Starts on its first call and closes a while after the last.",
      isNew: difference?.alwaysReady === true,
    });
  }

  return items;
}

/**
 * The Access section of a plugin built for plugin API 3, which declares no
 * hosts and runs with the access it always had. Only what the user can act
 * on is said: what it can reach, what it receives, and that updating moves
 * it to a plugin API that limits both.
 */
export function describeLegacyAccess(labels: AccessLabels): AccessItem[] {
  const item = (
    id: string,
    kind: AccessItemKind,
    title: string,
    detail: string,
  ): AccessItem => ({
    id,
    kind,
    title,
    detail,
    isNew: false,
    hasNewEndpoints: false,
  });
  return [
    item(
      "legacy:network",
      "network",
      "Any address",
      "It can contact any address, not only the ones its connections name.",
    ),
    item(
      "legacy:credential",
      "credential",
      "Each connection's saved settings",
      "It receives them as you saved them, tokens included.",
    ),
    ...(labels.tasks.length > 0
      ? [
          item(
            "legacy:agent",
            "agent",
            list(labels.tasks.map((task) => task.label)),
            "Agent tasks that get every Ajour tool.",
          ),
        ]
      : []),
  ];
}

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayAndClock = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function sameLocalDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "2 times, last at 14:32", or on another day "1 time, last on 22 Oct, 09:05". */
function timesAndLast(count: number, last: number | undefined, now: number) {
  const when = last
    ? sameLocalDay(last, now)
      ? `, last at ${clock.format(last)}`
      : `, last on ${dayAndClock.format(last)}`
    : "";
  return `${count} time${count === 1 ? "" : "s"}${when}`;
}

/**
 * The line about requests the broker refused because they asked for access
 * the plugin doesn't have, such as an endpoint it doesn't list, or undefined
 * when there are none.
 */
export function describeRefusedRequests(
  activity: PluginAccessActivity | undefined,
  now: number,
): string | undefined {
  const count = activity?.refusedCount;
  if (!count) return undefined;
  return `Asked for access it doesn't have, refused. ${timesAndLast(count, activity.lastRefusedAt, now)}.`;
}

/**
 * The line about attempts to connect directly, which the plugin's sandbox
 * blocked, or undefined when there are none.
 */
export function describeBlockedAttempts(
  activity: PluginAccessActivity | undefined,
  now: number,
): string | undefined {
  const count = activity?.directBlockedCount;
  if (!count) return undefined;
  return `Tried to connect directly, blocked. ${timesAndLast(count, activity.lastDirectBlockedAt, now)}. Ajour sends a plugin's requests only through its own connections.`;
}
