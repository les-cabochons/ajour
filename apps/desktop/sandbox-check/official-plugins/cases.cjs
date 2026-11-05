// The cases of the release check of the six official plugins (#403). Each
// one drives Ajour's local API as the window does, and reads what the fixture
// services received and what Ajour answered, wrote and logged.
//
// The data folder starts as the last release left it: the API 3 packages the
// official listing names, installed, and a version 7 state file, with their
// connections and every secret in plain text. Ajour upgrades it on the first
// request. The cases then install the API 4 releases over those packages.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createWorld } = require("./world.cjs");
const services = require("./services.cjs");

const { JIRA, GITHUB, AZURE, PROJECT, ORIGINAL_ESTIMATE, FEED } = services;

/** A secret calendar address, and the addresses its redirects go through. */
const ICS_SECRET = "s3cr3t-feed-9f2c41";
const HOP_SECRETS = ["hop-secret-a71e", "hop-secret-b82f", "hop-secret-c93a"];
const ICS_FEED = `https://calendar.example.test/feed/${ICS_SECRET}/basic.ics`;
const SECRETS = [
  JIRA.token,
  GITHUB.token,
  AZURE.token,
  ICS_SECRET,
  ...HOP_SECRETS,
];

const pass = (name) => process.stdout.write(`PASS ${name}\n`);

/**
 * The broker lets a plugin send 10 requests a second, 60 in a burst. A
 * connection that syncs as the upgrade left it and again after a save sends
 * more than that at once, so the check waits for the bucket to refill, as a
 * user's next sync would.
 */
const refill = () => new Promise((resolve) => setTimeout(resolve, 6_000));

/** The state file of the last release: every secret in plain text. */
function legacyState() {
  const connection = (id, pluginId, config, extras = {}) => ({
    id,
    pluginId,
    label: id,
    tenantLabel: "Fixture",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    config,
    configSummary: { host: "legacy" },
    connectedAt: 1,
    ...extras,
  });
  const github = (suffix, hostUrl) =>
    connection(`github_${suffix}`, "github", {
      hostUrl,
      token: GITHUB.token,
      include: "acme",
    });
  return {
    version: 7,
    connections: [
      connection("jira_main", "jira", {
        baseUrl: `https://${JIRA.host}`,
        email: JIRA.email,
        apiToken: JIRA.token,
        queryScope: "assigned_to_me",
        taskIconDisplayMode: "always",
      }),
      github("canonical", "https://github.com"),
      github("www", "https://www.github.com"),
      github("http", "http://github.com"),
      github("httpwww", "http://www.github.com"),
      github("port", "https://WWW.GITHUB.COM:8443/ignored/path?query=1#frag"),
      connection("azure_org", "azure_devops", {
        organizationUrl: `https://dev.azure.com/${AZURE.organization}`,
        personalAccessToken: AZURE.token,
        queryScope: "assigned_to_me",
        taskIconDisplayMode: "always",
        originalEstimateFieldName: "Original Estimate",
      }),
      connection("azure_project", "azure_devops", {
        organizationUrl: `https://dev.azure.com/${AZURE.organization}/${PROJECT}`,
        personalAccessToken: AZURE.token,
        queryScope: "assigned_to_me",
        taskIconDisplayMode: "always",
        originalEstimateFieldName: "Original Estimate",
      }),
      connection("ics_main", "ics", { calendarUrl: ICS_FEED }),
      connection("team_main", "team-sync", {
        baseUrl: "https://team.example.test",
        teamId: "team-1",
        teamSecret: "team-secret-7d3e",
      }),
    ],
    stagedImports: [],
    dismissedImportKeys: [],
    connectorBacklogStatuses: [],
    disabledPluginIds: [],
    agentRunner: {
      pluginValues: {
        "workday-agent": {
          timesheetUrl: "https://wd5.myworkday.com/fixture/enter-time",
          username: "ada@contoso.com",
        },
      },
    },
  };
}

/** The paused team sync plugin: API 3, which Ajour no longer runs. */
async function writeTeamSyncPackage(directory, marker) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "team-sync",
      version: "0.1.0",
      apiVersion: 3,
      displayName: "Team sync",
      iconSvg: "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z'/></svg>",
      entrypoint: "plugin.mjs",
      capabilities: { team: { apiVersion: 1 } },
      connectionFields: [
        { id: "label", label: "Label", type: "text", required: true },
        { id: "tenantLabel", label: "Team", type: "text", required: true },
        { id: "baseUrl", label: "Server", type: "url", required: true },
        { id: "teamId", label: "Team ID", type: "text" },
        {
          id: "teamSecret",
          label: "Team secret",
          type: "password",
          secret: true,
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(directory, "plugin.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "an API 3 package ran");
`,
  );
}

async function runCases(ctx) {
  const { load, runtime, userData, sourceRoot, legacyRoot, tar, output } = ctx;
  assert.ok(sourceRoot && legacyRoot, "The check needs its plugin folders.");
  const world = await createWorld();
  ctx.onCleanup(() => world.close());
  const jira = services.createJira();
  const github = services.createGitHub();
  const azure = services.createAzure();
  world.host(JIRA.host, jira.handler);
  world.host("api.github.com", github.api);
  // GitHub.com's own names are never the broker's destination: a request
  // that reaches one is a saved address the upgrade left behind.
  for (const name of ["github.com", "www.github.com"]) {
    world.host(name, () => ({ status: 404, body: "not the API" }));
  }
  world.host("dev.azure.com", azure.host);
  world.host("vssps.dev.azure.com", azure.identities);

  // The data folder an upgrade starts from.
  const installedRoot = path.join(userData, "plugins");
  await fs.mkdir(installedRoot, { recursive: true });
  for (const id of await fs.readdir(legacyRoot)) {
    await fs.cp(path.join(legacyRoot, id), path.join(installedRoot, id), {
      recursive: true,
    });
  }
  const teamMarker = path.join(userData, "team-sync-ran");
  await writeTeamSyncPackage(path.join(installedRoot, "team-sync"), teamMarker);
  const statePath = path.join(userData, "state.json");
  await fs.writeFile(statePath, JSON.stringify(legacyState()));

  const { createAppApiServer, stopAppApiServer, installPluginForServer } =
    await load("server.ts");
  const { MemorySecretVault } = await load(
    "test-support/memory-secret-vault.ts",
  );
  const { dispatchJsonRequest } = await load(
    "test-support/dispatch-json-request.ts",
  );
  const { windowServerOptions } = await load("test-support/window-token.ts");
  const { createRecordingSink } = await load(
    "../../../packages/wide-events/sinks.ts",
  );
  const sink = createRecordingSink();
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath,
    installedPluginDirectory: installedRoot,
    allowDevelopmentPlugins: false,
    pluginRuntime: runtime,
    vault: new MemorySecretVault(),
    brokerTransport: world.transport,
    brokerResolver: world.resolver,
    eventSink: sink,
  });
  ctx.onCleanup(() => stopAppApiServer(server));

  /** Every answer the API gave, to search for a secret. */
  const answers = [];
  const call = async (method, route, body) => {
    const answer = await dispatchJsonRequest(server, {
      method,
      path: route,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    answers.push(JSON.stringify(answer.body));
    return answer;
  };
  const ok = async (method, route, body) => {
    const answer = await call(method, route, body);
    assert.equal(
      answer.status,
      200,
      `${method} ${route} answered ${answer.status}: ${JSON.stringify(answer.body)}`,
    );
    return answer.body;
  };

  const groupOf = (overview, pluginId) =>
    overview.connectionGroups.find((group) => group.plugin.id === pluginId);
  const connectionOf = (overview, pluginId, id) =>
    groupOf(overview, pluginId)?.connections.find((entry) => entry.id === id);

  // ----------------------------------------------------- the upgrade itself
  {
    const overview = await ok("GET", "/api/plugins");
    for (const id of [
      "azure_devops",
      "github",
      "ics",
      "jira",
      "workday-agent",
      "team-sync",
    ]) {
      const plugin = overview.plugins.find((entry) => entry.id === id);
      assert.equal(plugin?.apiVersion, 3, `${id} is an API 3 package`);
      assert.equal(
        plugin.unavailableReason,
        "This plugin needs an update",
        `${id} stays installed, inactive`,
      );
      const group = groupOf(overview, id);
      if (group) assert.equal(group.enabled, false, `${id} is off`);
    }
    // Connections and non-secret settings are kept; secrets moved to the vault.
    const kept = connectionOf(overview, "team-sync", "team_main");
    assert.equal(kept.editableValues.baseUrl, "https://team.example.test");
    assert.equal(kept.editableValues.teamId, "team-1");
    assert.equal(kept.secretFields[0].state, "saved");
    assert.equal(
      connectionOf(overview, "jira", "jira_main").editableValues.email,
      JIRA.email,
    );
    assert.equal(
      connectionOf(overview, "azure_devops", "azure_project").editableValues
        .organizationUrl,
      `https://dev.azure.com/${AZURE.organization}/${PROJECT}`,
    );
    for (const suffix of ["canonical", "www", "http", "httpwww", "port"]) {
      assert.equal(
        connectionOf(overview, "github", `github_${suffix}`).editableValues
          .hostUrl,
        "https://github.com",
        `github_${suffix} is saved as https://github.com`,
      );
    }
    const stateText = await fs.readFile(statePath, "utf8");
    assert.equal(JSON.parse(stateText).version >= 10, true);
    for (const secret of SECRETS) {
      assert.ok(
        !stateText.includes(secret),
        "no secret stays in the state file",
      );
    }
    // Nothing an API 3 package holds runs, and every operation says why.
    const refused = await call(
      "POST",
      "/api/plugins/jira/connections/jira_main/sync",
      {},
    );
    assert.notEqual(refused.status, 200);
    assert.match(JSON.stringify(refused.body), /needs an update/);
    await assert.rejects(fs.access(teamMarker), "an API 3 package never runs");
    pass("an upgrade keeps API 3 packages inactive with their connections");
    pass("an upgrade rewrites every legacy GitHub.com address once");
  }

  // ------------------------------------- the six API 4 releases, installed
  const releases = [
    ["jira", "jira"],
    ["github", "github"],
    ["azure-devops", "azure_devops"],
    ["ics", "ics"],
    ["workday-agent", "workday-agent"],
    ["workday-project-data", "workday-project-data"],
  ];
  for (const [folder, id] of releases) {
    const directory = path.join(sourceRoot, "plugins", folder);
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, "plugin.json"), "utf8"),
    );
    assert.equal(manifest.id, id);
    assert.equal(manifest.apiVersion, 4);
    const archive = path.join(userData, `${folder}.ajour-connector`);
    await tar.create({ cwd: directory, file: archive, gzip: true }, ["."]);
    await installPluginForServer(
      server,
      await fs.readFile(archive),
      path.basename(archive),
    );
    await ok("POST", `/api/plugins/${id}/activation`, { enabled: true });
  }
  {
    const overview = await ok("GET", "/api/plugins");
    for (const [, id] of releases) {
      const plugin = overview.plugins.find((entry) => entry.id === id);
      assert.equal(plugin?.apiVersion, 4, `${id} runs on API 4`);
      assert.equal(plugin.unavailableReason, undefined, `${id} is available`);
    }
    pass("the six API 4 releases install over the API 3 packages");
  }

  /** Saves a connection again as the settings form does, validating it. */
  const resave = async (pluginId, connectionId, patch = {}, access) => {
    const overview = await ok("GET", "/api/plugins");
    const connection = connectionOf(overview, pluginId, connectionId);
    assert.ok(connection, `${connectionId} is kept`);
    const answer = await ok("POST", `/api/plugins/${pluginId}/connections`, {
      id: connectionId,
      values: { ...connection.editableValues, ...patch },
      ...(access ? { access } : {}),
    });
    return answer.connection;
  };
  const sync = (pluginId, connectionId, body = {}) =>
    ok("POST", `/api/plugins/${pluginId}/connections/${connectionId}/sync`, {
      trigger: "manual",
      ...body,
    });

  // ------------------------------------------------------------------ Jira
  // Each upgraded connection syncs once as it was left, before anything
  // re-saves it: a connection that fails until the user opens and saves it
  // would break "no action from the user". Only then is it saved again.
  {
    const asLeft = world.mark();
    const first = await sync("jira", "jira_main");
    assert.equal(
      first.stagedCount + first.updatedCount,
      1,
      "the API 3 Jira connection syncs its issue as it was left",
    );
    assert.ok(world.since(asLeft, JIRA.host).length >= 1);
    pass("jira: an API 3 connection syncs with its saved token, untouched");

    const mark = world.mark();
    await resave("jira", "jira_main");
    const result = await sync("jira", "jira_main");
    assert.equal(
      result.stagedCount + result.updatedCount,
      1,
      "the Jira connection syncs its issue after a save",
    );
    assert.ok(world.since(mark, JIRA.host).length >= 2);
    pass("jira: an API 3 connection validates and syncs with its saved token");
  }

  // ---------------------------------------------------------------- GitHub
  {
    const reachOnlyTheApi = async (id, step) => {
      const mark = world.mark();
      await step();
      const hosts = new Set(world.since(mark).map((request) => request.host));
      assert.deepEqual(
        [...hosts],
        ["api.github.com"],
        `${id} reaches only the API`,
      );
    };
    const syncAll = async (id) => {
      await sync("github", id);
      await ok(
        "POST",
        `/api/code-hosts/github/connections/${id}/syncPullRequests`,
        { tracked: [] },
      );
    };
    // As the upgrade left them: no re-save yet.
    for (const suffix of ["canonical", "www", "http", "httpwww", "port"]) {
      const id = `github_${suffix}`;
      await reachOnlyTheApi(id, () => syncAll(id));
    }
    pass(
      "github: every legacy connection syncs through api.github.com, untouched",
    );

    await refill();
    for (const suffix of ["canonical", "www", "http", "httpwww", "port"]) {
      const id = `github_${suffix}`;
      await reachOnlyTheApi(id, async () => {
        const saved = await resave("github", id);
        assert.equal(saved.id, id);
        await syncAll(id);
      });
      const overview = await ok("GET", "/api/plugins");
      assert.equal(
        connectionOf(overview, "github", id).editableValues.hostUrl,
        "https://github.com",
      );
    }
    pass(
      "github: every legacy address validates and syncs through api.github.com",
    );
  }

  // ---------------------------------------------------------- Azure DevOps
  for (const id of ["azure_org", "azure_project"]) {
    // As the upgrade left it: it syncs before any re-save.
    {
      const asLeft = world.mark();
      const first = await sync("azure_devops", id);
      assert.ok(
        first.stagedCount + first.updatedCount >= 1,
        `${id}: the upgraded connection syncs its items untouched`,
      );
      assert.ok(world.since(asLeft, "dev.azure.com").length > 0);
    }
    await refill();
    const mark = world.mark();
    const saved = await resave("azure_devops", id, {}, [
      "editWorkItems",
      "pullRequests",
      "peopleSearch",
    ]);
    assert.deepEqual(
      [...(saved.access ?? [])].sort(),
      ["editWorkItems", "peopleSearch", "pullRequests", "readBacklog"].sort(),
    );
    const overview = await ok("GET", "/api/plugins");
    const savedUrl = connectionOf(overview, "azure_devops", id).editableValues
      .organizationUrl;
    const sourceId = `${savedUrl.replace(/\/+$/, "")}/${PROJECT}/_workitems/edit/42`;
    azure.state.items.get(42).fields[ORIGINAL_ESTIMATE] = 4;
    const tracked = {
      localWorkItemId: `local-42-${id}`,
      sourceId,
      originalEstimateHours: 6,
      estimateSync: {
        originalEstimateHours: { baselineValue: 4, remoteValue: 4 },
      },
    };
    const first = await sync("azure_devops", id, { workItems: [tracked] });
    assert.equal(
      first.stagedCount + first.updatedCount,
      1,
      `${id}: item 42 syncs`,
    );
    assert.deepEqual(
      first.workItemUpdates.map((update) => [
        update.localWorkItemId,
        update.sourceId,
        update.fields.originalEstimateHours?.status,
      ]),
      [[tracked.localWorkItemId, sourceId, "pushed"]],
      `${id}: the tracked id and source id are kept`,
    );
    assert.equal(azure.state.items.get(42).fields[ORIGINAL_ESTIMATE], 6);
    const refreshed = await sync("azure_devops", id, {
      workItems: [tracked],
      sourceId,
      refresh: true,
    });
    assert.equal(refreshed.connection.id, id);
    await ok(
      "POST",
      `/api/plugins/azure_devops/connections/${id}/settle-states`,
      { sourceId },
    );
    await ok("POST", `/api/plugins/azure_devops/connections/${id}/settle`, {
      sourceId,
      state: "Resolved",
    });
    assert.equal(azure.state.items.get(42).fields["System.State"], "Resolved");
    azure.state.items.get(42).fields["System.State"] = "Active";
    const posted = await ok(
      "POST",
      `/api/backlog-comments/azure_devops/connections/${id}/postItemComment`,
      { sourceId, body: `Still connected after the upgrade (${id})` },
    );
    assert.ok(posted.comment?.id, `${id}: the comment is posted`);
    const listed = await ok(
      "POST",
      `/api/backlog-comments/azure_devops/connections/${id}/listItemComments`,
      { sourceId, limit: 20 },
    );
    assert.ok(
      listed.comments.some((comment) => String(comment.body).includes(id)),
      `${id}: the comment reads back`,
    );
    await ok(
      "POST",
      `/api/code-hosts/azure_devops/connections/${id}/syncPullRequests`,
      { tracked: [] },
    );
    assert.ok(world.since(mark).length > 0);
  }
  pass(
    "azure devops: org and project URL connections sync untouched, then refresh, settle and comment",
  );

  // ------------------------------------------------------------------- ICS
  await require("./ics-cases.cjs").run({
    world,
    ok,
    call,
    resave,
    pass,
    assert,
    ICS_SECRET,
    HOP_SECRETS,
    FEED,
    ICS_FEED,
    installPluginForServer,
    server,
    sink,
    tar,
    userData,
  });

  // --------------------------------------------------------------- Workday
  {
    const agents = await ok("GET", "/api/agents");
    const tasks = agents.tasks.filter(
      (task) => task.pluginId === "workday-agent",
    );
    assert.deepEqual(tasks.map((task) => task.taskId).sort(), [
      "commit-week",
      "submit-week",
    ]);
    for (const task of tasks) {
      assert.deepEqual(task.values, {
        timesheetUrl: "https://wd5.myworkday.com/fixture/enter-time",
        username: "ada@contoso.com",
      });
    }
    pass(
      "workday-agent: both tasks are listed with the settings the user saved",
    );

    const shapes = await ok("GET", "/api/project-data-shapes");
    assert.deepEqual(
      shapes.plugins.map((plugin) => plugin.id),
      ["workday-project-data"],
    );
    const imported = await ok(
      "POST",
      "/api/project-data-shapes/workday-project-data/import",
      {
        sheets: [
          {
            name: "Sheet1",
            rows: [["Afficher un projet: 100200 Acme - Support [Q-1]"]],
          },
          {
            name: "Récapitulatif",
            rows: [
              ["Récapitulatif d'un projet - Vue composite"],
              ["Récapitulatif du projet"],
              ["Nom du projet", "Acme - Support [Q-1]"],
              ["Date de début", "2026-06-01T00:00:00.000Z"],
              ["Identifiant du projet", "100200"],
              ["Inactif", "Non"],
            ],
          },
          {
            name: "Ressources des tâches",
            rows: [
              [
                "View Task Resources (Composite View): 100200 Acme - Support [Q-1]",
              ],
              ["Mass Update Task Resource", "Mettre à jour en masse"],
              [],
              ["Tâches du plan de projet"],
              [
                "Phase de projet - Tâche de projet",
                "Phase de projet",
                "Tâche de projet",
              ],
              [
                "Support > Billet #101 - Login",
                "Support",
                "Billet #101 - Login",
              ],
            ],
          },
        ],
      },
    );
    assert.equal(imported.projects[0].code, "100200");
    assert.equal(imported.projects[0].tasks[0].name, "Billet #101 - Login");
    pass("workday-project-data: imports a project export");

    // A data shape plugin the user turned off is neither listed nor run, as
    // any plugin of the plugin host.
    // The plugin run's own event: the route's event has the same name.
    const operations = (name, outcome) =>
      sink.events.filter(
        (event) =>
          event.name === name &&
          event.kind === "plugin_operation" &&
          event.outcome === outcome,
      ).length;
    const importedBefore = operations("project.import", "ok");
    const refusedBefore = operations("project.import", "refused");
    await ok("POST", "/api/plugins/workday-project-data/activation", {
      enabled: false,
    });
    assert.deepEqual(
      (await ok("GET", "/api/project-data-shapes")).plugins,
      [],
      "an inactive data shape plugin is not listed",
    );
    const refused = await call(
      "POST",
      "/api/project-data-shapes/workday-project-data/import",
      { sheets: [{ name: "Sheet1", rows: [["Afficher un projet"]] }] },
    );
    assert.equal(refused.status, 400);
    assert.match(JSON.stringify(refused.body), /Activate this plugin/);
    assert.equal(
      operations("project.import", "ok"),
      importedBefore,
      "an inactive data shape plugin runs nothing",
    );
    assert.equal(operations("project.import", "refused"), refusedBefore + 1);
    assert.equal(
      sink.events.findLast(
        (event) =>
          event.name === "project.import" && event.kind === "plugin_operation",
      )?.outcome_reason,
      "plugin_off",
    );
    await ok("POST", "/api/plugins/workday-project-data/activation", {
      enabled: true,
    });
    assert.equal(
      (await ok("GET", "/api/project-data-shapes")).plugins.length,
      1,
    );
    pass("workday-project-data: turned off, it is neither listed nor run");
  }

  // ---------------------------------------------------- nothing leaked
  {
    const events = JSON.stringify(sink.events);
    const stateText = await fs.readFile(statePath, "utf8");
    const everything = {
      "an API answer": answers.join("\n"),
      "a wide event": events,
      "the app's output": output.join(""),
      "the state file": stateText,
    };
    for (const secret of SECRETS) {
      for (const [where, text] of Object.entries(everything)) {
        assert.ok(!text.includes(secret), `a secret is in ${where}`);
      }
    }
    pass(
      "no credential or secret address reaches an answer, an event, the state file or the output",
    );
  }
  void FEED;
}

module.exports = { runCases };
