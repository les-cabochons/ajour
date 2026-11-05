// The calendar cases of the release check (#403): a secret feed address
// reached through 1, 2 and 3 HTTPS redirects, including redirects to other
// hosts, syncs. A fourth redirect, one to a private address, one to a
// metadata address, one to a loopback name and one that downgrades to http
// are refused before anything is sent to them. Neither the address nor any
// redirect address reaches the plugin, a log or the interface.
//
// The official ICS plugin does the real work. A probe plugin with the same
// auth scheme returns everything its `ajour.http` call received, so the
// check can read what a plugin sees.
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const RANGE = { from: "2026-11-02", to: "2026-11-02", timeZone: "UTC" };

/** The probe plugin: the calendar scheme, and a plugin that tells all it got. */
const PROBE = {
  manifest: {
    id: "feed-probe",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "Feed probe",
    iconSvg: "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z'/></svg>",
    entrypoint: "plugin.mjs",
    capabilities: { calendar: {} },
    connectionFields: [
      { id: "label", label: "Label", type: "text", required: true },
      { id: "tenantLabel", label: "Calendar", type: "text", required: true },
      {
        id: "calendarUrl",
        label: "Calendar address",
        type: "url",
        required: true,
        secret: true,
      },
    ],
    network: {
      auth: { scheme: "secretAddress", secretField: "calendarUrl" },
      requestHeaders: ["Accept"],
    },
    runtime: { start: "whenNeeded" },
  },
  source: `
export async function validateConnection() {
  return { normalizedConfig: {}, connectionSummary: {} };
}
export async function listCalendarEvents(connection, request) {
  const response = await ajour.http({
    connectionId: connection.id,
    method: "GET",
    path: "",
    headers: { Accept: "text/calendar" },
  });
  const seen = JSON.stringify({
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    own: Object.getOwnPropertyNames(response),
    connection,
    body: await response.text(),
  });
  const start = Date.parse(request.from + "T12:00:00Z");
  const events = [];
  for (let at = 0; at < seen.length; at += 100) {
    events.push({
      eventId: "probe-" + at,
      startsAt: start,
      endsAt: start + 60000,
      allDay: false,
      title: seen.slice(at, at + 100),
      status: "confirmed",
      response: "unknown",
      busy: true,
    });
  }
  return { events };
}
`,
};

async function run(context) {
  const {
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
    tar,
    userData,
  } = context;
  const FEED_PATH = `/feed/${ICS_SECRET}/basic.ics`;
  const [hopA, hopB, hopC] = HOP_SECRETS;

  // One table of routes for the calendar hosts: a path answers with a feed
  // or a redirect. A host that is not here is not a host.
  const routes = new Map();
  const redirect = (from, to) => routes.set(from, { redirect: to });
  const hostNames = [
    "calendar.example.test",
    "edge.example.test",
    "cdn.example.test",
    "files.example.org",
    "internal.example.test",
    "localhost",
    "169.254.169.254",
  ];
  for (const name of hostNames) {
    world.host(name, (request) => {
      const route = routes.get(`${request.host}${request.path}`);
      if (route?.redirect) {
        return { status: 302, headers: { location: route.redirect } };
      }
      if (
        route?.feed ||
        `${request.host}${request.path}` === `calendar.example.test${FEED_PATH}`
      ) {
        return {
          status: 200,
          headers: { "content-type": "text/calendar" },
          body: FEED,
        };
      }
      return { status: 404, body: "not a calendar" };
    });
  }
  world.privateHost("internal.example.test", "10.0.0.5");
  world.privateHost("localhost", "127.0.0.1");

  const feed = `https://calendar.example.test${FEED_PATH}`;
  const chains = {
    one: `https://calendar.example.test/r1/${hopA}`,
    two: `https://edge.example.test/r2/${hopA}`,
    three: `https://edge.example.test/r3/${hopA}`,
    four: `https://edge.example.test/r4/${hopA}`,
  };
  redirect(`calendar.example.test/r1/${hopA}`, feed);
  redirect(
    `edge.example.test/r2/${hopA}`,
    `https://cdn.example.test/r2b/${hopB}`,
  );
  redirect(`cdn.example.test/r2b/${hopB}`, feed);
  redirect(
    `edge.example.test/r3/${hopA}`,
    `https://cdn.example.test/r3b/${hopB}`,
  );
  redirect(
    `cdn.example.test/r3b/${hopB}`,
    `https://files.example.org/r3c/${hopC}`,
  );
  redirect(`files.example.org/r3c/${hopC}`, feed);
  redirect(
    `edge.example.test/r4/${hopA}`,
    `https://cdn.example.test/r4b/${hopB}`,
  );
  redirect(
    `cdn.example.test/r4b/${hopB}`,
    `https://files.example.org/r4c/${hopC}`,
  );
  redirect(
    `files.example.org/r4c/${hopC}`,
    `https://calendar.example.test/r4d/${hopA}`,
  );
  redirect(`calendar.example.test/r4d/${hopA}`, feed);

  const unsafe = {
    private: `https://internal.example.test/feed/${hopB}`,
    metadata: `https://169.254.169.254/latest/${hopB}`,
    loopback: `https://localhost/feed/${hopB}`,
    downgrade: `http://calendar.example.test${FEED_PATH}`,
  };
  for (const [kind, target] of Object.entries(unsafe)) {
    redirect(`edge.example.test/u/${kind}/${hopA}`, target);
  }

  // The probe is an API 4 package of its own, installed like any other.
  const probeDirectory = path.join(userData, "probe-source");
  await fs.mkdir(probeDirectory, { recursive: true });
  await fs.writeFile(
    path.join(probeDirectory, "plugin.json"),
    JSON.stringify(PROBE.manifest),
  );
  await fs.writeFile(path.join(probeDirectory, "plugin.mjs"), PROBE.source);
  const probeArchive = path.join(userData, "feed-probe.ajour-connector");
  await tar.create({ cwd: probeDirectory, file: probeArchive, gzip: true }, [
    ".",
  ]);
  await installPluginForServer(
    server,
    await fs.readFile(probeArchive),
    path.basename(probeArchive),
  );
  await ok("POST", "/api/plugins/feed-probe/activation", { enabled: true });

  const addresses = [
    ICS_FEED,
    feed,
    ...Object.values(chains),
    ...Object.values(unsafe),
    "calendar.example.test",
    "edge.example.test",
    "cdn.example.test",
    "files.example.org",
  ];
  const save = (pluginId, name, calendarUrl) =>
    call("POST", `/api/plugins/${pluginId}/connections`, {
      values: { label: name, tenantLabel: "Fixture", calendarUrl },
    });
  const events = async (pluginId, connectionId) => {
    const answer = await call(
      "POST",
      `/api/calendars/${pluginId}/connections/${connectionId}/listCalendarEvents`,
      RANGE,
    );
    return answer;
  };
  const noAddress = (value, what) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const address of [...addresses, ICS_SECRET, ...HOP_SECRETS]) {
      assert.ok(
        !text.includes(address),
        `${what} holds an address: ${address}`,
      );
    }
  };

  // The legacy connection, saved on API 3 and untouched, lists its events.
  {
    const answer = await events("ics", "ics_main");
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.deepEqual(
      answer.body.events.map((event) => event.title),
      ["Fixture meeting"],
    );
    pass("ics: an API 3 connection lists its events with no action");
  }

  // 1, 2 and 3 redirects, to other hosts too.
  for (const hops of ["one", "two", "three"]) {
    const saved = await save("ics", `ics-${hops}`, chains[hops]);
    assert.equal(saved.status, 200, `${hops}: ${JSON.stringify(saved.body)}`);
    const answer = await events("ics", saved.body.connection.id);
    assert.equal(answer.status, 200, `${hops}: ${JSON.stringify(answer.body)}`);
    assert.deepEqual(
      answer.body.events.map((event) => event.title),
      ["Fixture meeting"],
    );
    // The probe reads what a plugin gets through the same chain.
    const probe = await save("feed-probe", `probe-${hops}`, chains[hops]);
    assert.equal(probe.status, 200, JSON.stringify(probe.body));
    const seen = await events("feed-probe", probe.body.connection.id);
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
    const text = seen.body.events.map((event) => event.title).join("");
    assert.match(text, /"status":200/);
    assert.match(text, /BEGIN:VCALENDAR/);
    noAddress(text, `what the plugin received through ${hops} redirect(s)`);
  }
  pass("ics: a secret feed address syncs through 1, 2 and 3 HTTPS redirects");

  // A fourth redirect, and the unsafe targets, are refused.
  const refusals = { four: chains.four };
  for (const kind of Object.keys(unsafe)) {
    refusals[kind] = `https://edge.example.test/u/${kind}/${hopA}`;
  }
  for (const [kind, address] of Object.entries(refusals)) {
    const mark = world.mark();
    const saved = await save("ics", `ics-refused-${kind}`, address);
    assert.notEqual(saved.status, 200, `${kind} must be refused`);
    noAddress(saved.body, `the refusal of ${kind}`);
    const reached = world
      .since(mark)
      .map((request) => `${request.host}${request.path}`);
    assert.ok(
      !reached.some((target) =>
        /internal\.example|localhost|169\.254/.test(target),
      ),
      `${kind}: nothing was sent to a private target (${reached.join(", ")})`,
    );
    if (kind === "downgrade") {
      assert.ok(
        !reached.includes(`calendar.example.test${FEED_PATH}`),
        "nothing was sent over http",
      );
    }
  }
  pass(
    "ics: a fourth redirect and an unsafe redirect target are refused, unseen",
  );

  // A saved feed that starts redirecting somewhere unsafe fails the same way.
  redirect(`calendar.example.test${FEED_PATH}`, unsafe.private);
  {
    const answer = await events("ics", "ics_main");
    assert.notEqual(answer.status, 200);
    noAddress(
      answer.body,
      "the error of a feed that now redirects to a private host",
    );
  }
  routes.delete(`calendar.example.test${FEED_PATH}`);
  void resave;
  pass(
    "ics: a feed that later redirects to a private address fails without naming it",
  );
}

module.exports = { run };
