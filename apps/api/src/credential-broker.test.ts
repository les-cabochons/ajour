import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  pluginApi4ManifestSchema,
  type PluginApi4Manifest,
} from "../../../packages/shared/plugin-api-4.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  BrokerRequestError,
  CredentialBroker,
  type BrokerConnection,
  type BrokerLimits,
  type BrokerResolver,
  type BrokerTransportRequest,
  type BrokerTransportResponse,
} from "./credential-broker.ts";
import { createApiEvents } from "./events.ts";

/*
 * Seam 2 of the spec #381: the broker port, in plain Node, with a fake
 * transport and a fake resolver. Each test drives `forOperation(...).http`
 * or `.publicFetch` as a plugin's runtime would, and asserts what the
 * service received, what the plugin got back, the event and the records.
 */

const TOKEN = "tok-9f2c1e/7a+b=Q";
const ICON = "<svg viewBox='0 0 16 16' />";

function manifest(overrides: Record<string, unknown> = {}): PluginApi4Manifest {
  return pluginApi4ManifestSchema.parse({
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
    capabilities: { connector: {} },
    network: {
      auth: { scheme: "basic", userField: "email", secretField: "apiToken" },
      baseAddress: { field: "baseUrl", allowOnPremises: true },
      endpoints: [
        { method: "GET", path: "/rest/api/3/myself" },
        { method: "GET", path: "/rest/api/3/issue/*" },
        { method: "GET", path: "/rest/api/3/attachment/**" },
        { method: "POST", path: "/rest/api/3/search/jql" },
        { method: "PUT", path: "/rest/api/3/issue/*", access: "editIssues" },
        { method: "GET", path: "/rest/api/3/field", access: "readFields" },
      ],
      requestHeaders: ["Accept", "Content-Type"],
      publicHosts: ["avatars.example-cdn.com"],
    },
    connectionAccess: [
      { id: "readFields", label: "Read fields", always: true },
      {
        id: "editIssues",
        label: "Edit issues",
        operations: ["writeSettle"],
      },
    ],
    ...overrides,
  });
}

function jiraConnection(
  overrides: Partial<BrokerConnection> = {},
  values: Record<string, string> = {},
): BrokerConnection {
  return {
    id: "jira_1",
    values: {
      baseUrl: "https://acme.atlassian.net",
      email: "ada@acme.test",
      apiToken: TOKEN,
      ...values,
    },
    secrets: [values.apiToken ?? TOKEN],
    onPremises: false,
    access: [],
    ...overrides,
  };
}

type Responder = (
  request: BrokerTransportRequest,
) =>
  Partial<BrokerTransportResponse> | Promise<Partial<BrokerTransportResponse>>;

/** A transport that answers from `respond` and records what it was sent. */
function fakeTransport(respond: Responder = () => ({ status: 200 })) {
  const sent: BrokerTransportRequest[] = [];
  return {
    sent,
    transport: {
      async send(request: BrokerTransportRequest) {
        sent.push(request);
        const answer = await respond(request);
        return {
          status: answer.status ?? 200,
          headers: answer.headers ?? {},
          body: answer.body ?? new Uint8Array(),
          ...(answer.remoteAddress !== undefined
            ? { remoteAddress: answer.remoteAddress }
            : {}),
        };
      },
    },
  };
}

/** A resolver that answers from a table, with a public address for any other host. */
function fakeResolver(
  table: Record<string, readonly string[]> = {},
  options: { proxied?: boolean } = {},
): BrokerResolver & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async resolve(hostname) {
      asked.push(hostname);
      if (hostname in table) {
        return {
          addresses: table[hostname]!,
          ...(options.proxied ? { proxied: true } : {}),
        };
      }
      return { addresses: ["151.101.1.69", "2a04:4e42::645"] };
    },
  };
}

const text = (body: Uint8Array) => new TextDecoder().decode(body);
const bytes = (value: string) => new TextEncoder().encode(value);

interface Setup {
  manifest?: PluginApi4Manifest;
  /** Each plugin's saved connections. */
  connections?: Record<string, BrokerConnection[]>;
  respond?: Responder;
  resolver?: BrokerResolver;
  limits?: Partial<BrokerLimits>;
  noTransport?: boolean;
  operationRefusal?: Awaited<
    ReturnType<
      NonNullable<
        ConstructorParameters<
          typeof CredentialBroker
        >[0]["connections"]["operationRefusal"]
      >
    >
  >;
  now?: () => number;
}

function setup(options: Setup = {}) {
  const sink = createRecordingSink<AjourEvent>();
  const events = createApiEvents({ sink, userDataPath: os.tmpdir() });
  const { sent, transport } = fakeTransport(options.respond);
  const resolver = options.resolver ?? fakeResolver();
  const activity: {
    kind: "request" | "blocked";
    pluginId: string;
    connectionId?: string;
  }[] = [];
  const connections = options.connections ?? {
    "ajc-jira": [jiraConnection()],
  };
  const broker = new CredentialBroker({
    ...(options.noTransport ? {} : { transport }),
    resolver,
    events,
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.now ? { now: options.now } : {}),
    connections: {
      async connection(pluginId, connectionId) {
        return (connections[pluginId] ?? []).find(
          (connection) => connection.id === connectionId,
        );
      },
      async operationRefusal() {
        return options.operationRefusal;
      },
    },
    activity: {
      async recordRequest(pluginId, connectionId) {
        activity.push({
          kind: "request",
          pluginId,
          ...(connectionId ? { connectionId } : {}),
        });
      },
      async recordBlocked(pluginId, connectionId) {
        activity.push({
          kind: "blocked",
          pluginId,
          ...(connectionId ? { connectionId } : {}),
        });
      },
    },
  });
  const operation = (
    pluginId = "ajc-jira",
    caller: { manifest?: PluginApi4Manifest; pending?: BrokerConnection } = {},
  ) =>
    broker.forOperation({
      pluginId,
      manifest: caller.manifest ?? options.manifest ?? manifest(),
      method: "syncConnection",
      ...(caller.pending ? { pending: caller.pending } : {}),
    });
  const requestEvents = () =>
    sink.events.filter((event) => event.name === "plugin.request");
  return { broker, operation, sent, resolver, activity, requestEvents, sink };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(BrokerRequestError);
  return error as BrokerRequestError;
}

describe("the credential broker", () => {
  describe("a request through a connection", () => {
    it("builds the URL from the saved address and attaches the Basic credential", async () => {
      const { operation, sent } = setup({
        respond: () => ({
          status: 200,
          headers: { "content-type": "application/json" },
          body: bytes('{"displayName":"Ada"}'),
        }),
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
        query: { expand: ["groups", "applicationRoles"], limit: 5 },
        headers: { Accept: "application/json" },
      });

      expect(response.status).toBe(200);
      expect(text(response.body)).toBe('{"displayName":"Ada"}');
      expect(response.headers).toEqual({ "content-type": "application/json" });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        url: "https://acme.atlassian.net/rest/api/3/myself?expand=groups&expand=applicationRoles&limit=5",
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Basic ${Buffer.from(`ada@acme.test:${TOKEN}`).toString("base64")}`,
        },
      });
    });

    it("attaches each auth scheme's credential", async () => {
      const cases = [
        {
          auth: { scheme: "bearer", secretField: "apiToken" },
          header: ["authorization", `Bearer ${TOKEN}`],
        },
        {
          auth: { scheme: "patBasic", secretField: "apiToken" },
          header: [
            "authorization",
            `Basic ${Buffer.from(`:${TOKEN}`).toString("base64")}`,
          ],
        },
        {
          auth: {
            scheme: "headerTemplate",
            header: "X-Api-Key",
            template: "Key {secret}",
            secretField: "apiToken",
          },
          header: ["x-api-key", `Key ${TOKEN}`],
        },
      ];
      for (const { auth, header } of cases) {
        const base = manifest();
        const { operation, sent } = setup({
          manifest: manifest({ network: { ...base.network, auth } }),
        });
        await operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
        });
        expect(sent[0]!.headers[header[0]!]).toBe(header[1]);
      }
    });

    it("puts a secret into a header template as it is, $ patterns included", async () => {
      const base = manifest();
      const { operation, sent } = setup({
        manifest: manifest({
          network: {
            ...base.network,
            auth: {
              scheme: "headerTemplate",
              header: "X-Api-Key",
              template: "Key {secret}",
              secretField: "apiToken",
            },
          },
        }),
        connections: {
          "ajc-jira": [jiraConnection({}, { apiToken: "a$&b$'c" })],
        },
      });

      await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });

      expect(sent[0]!.headers["x-api-key"]).toBe("Key a$&b$'c");
    });

    it("sends no credential when the manifest declares no auth scheme", async () => {
      const base = manifest();
      const { auth: _auth, ...network } = base.network!;
      const { operation, sent } = setup({ manifest: manifest({ network }) });

      await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });

      expect(sent[0]!.headers).toEqual({});
    });

    it("refuses the auth schemes this version reserves", () => {
      expect(() =>
        manifest({
          network: {
            ...manifest().network,
            auth: { scheme: "bodyField", secretField: "apiToken" },
          },
        }),
      ).toThrow("The body-field auth scheme is reserved");
    });
  });

  describe("resolving the connection", () => {
    it("gives another plugin's connection id the same error as an unknown one, and sends nothing", async () => {
      const { operation, sent, requestEvents, activity } = setup({
        connections: {
          "ajc-jira": [jiraConnection()],
          "ajc-github": [jiraConnection({ id: "github_1" })],
        },
      });

      const other = await refusal(
        operation().http({
          connectionId: "github_1",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      );
      const bogus = await refusal(
        operation().http({
          connectionId: "nope_1",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      );

      expect({ ...other, message: other.message }).toEqual({
        ...bogus,
        message: bogus.message,
      });
      expect(other).toMatchObject({
        name: "AjourRequestError",
        code: "refused",
        reason: "connection_not_found",
        message: "This plugin has no connection with that id.",
      });
      expect(sent).toEqual([]);
      const [first, second] = requestEvents();
      expect(first).toMatchObject({
        name: "plugin.request",
        kind: "job",
        outcome: "refused",
        outcome_reason: "connection_not_found",
      });
      expect(first?.connection).toBeUndefined();
      const {
        span_id: _a,
        trace_id: _b,
        started_at: _c,
        duration_ms: _d,
        ...firstFacts
      } = first!;
      const {
        span_id: _e,
        trace_id: _f,
        started_at: _g,
        duration_ms: _h,
        ...secondFacts
      } = second!;
      // Apart from times, the two events say the same.
      const withoutTimes = (facts: typeof firstFacts) => ({
        ...facts,
        broker: { ...facts.broker, queued_ms: 0 },
      });
      expect(withoutTimes(firstFacts)).toEqual(withoutTimes(secondFacts));
      expect(activity).toEqual([
        { kind: "blocked", pluginId: "ajc-jira" },
        { kind: "blocked", pluginId: "ajc-jira" },
      ]);
    });

    it("uses a connection being validated only within its own operation, and never stores it", async () => {
      const { operation, sent, activity, requestEvents } = setup({
        connections: { "ajc-jira": [] },
      });
      const pending = jiraConnection({ id: "pending-1" });

      await operation("ajc-jira", { pending }).http({
        connectionId: "pending-1",
        method: "GET",
        path: "/rest/api/3/myself",
      });
      const elsewhere = await refusal(
        operation().http({
          connectionId: "pending-1",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      );

      expect(sent).toHaveLength(1);
      expect(elsewhere.reason).toBe("connection_not_found");
      expect(activity[0]).toEqual({ kind: "request", pluginId: "ajc-jira" });
      expect(requestEvents()[0]).toMatchObject({
        outcome: "ok",
        broker: { pending: true },
      });
      expect(requestEvents()[0]?.connection).toBeUndefined();
    });

    it("holds a connection being validated to the manifest's on-premises and access rules, as a saved one", async () => {
      const closed = manifest({
        network: {
          ...manifest().network,
          baseAddress: { field: "baseUrl" },
        },
      });
      const local = jiraConnection(
        { id: "pending-2", onPremises: true },
        { baseUrl: "https://10.0.0.5/jira" },
      );
      const dropped = jiraConnection({ id: "pending-3", access: ["dropped"] });
      const { operation, sent } = setup({ connections: { "ajc-jira": [] } });

      const privateAddress = await refusal(
        operation("ajc-jira", { manifest: closed, pending: local }).http({
          connectionId: "pending-2",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      );
      const accessOff = await refusal(
        operation("ajc-jira", { pending: dropped }).http({
          connectionId: "pending-3",
          method: "PUT",
          path: "/rest/api/3/issue/ENG-1",
        }),
      );

      expect(privateAddress.reason).toBe("private_address");
      expect(accessOff.reason).toBe("access_off");
      expect(sent).toEqual([]);
    });

    it("refuses every request outside the desktop app", async () => {
      const { operation } = setup({ noTransport: true });

      const error = await refusal(
        operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      );

      expect(error).toMatchObject({
        code: "refused",
        reason: "no_transport",
        message: "Plugins reach the network only in the Ajour desktop app.",
      });
    });

    it("refuses the requests of an operation whose plugin was turned off since it started", async () => {
      const { operation, sent } = setup({
        operationRefusal: {
          reason: "plugin_off",
          message: 'Plugin "ajc-jira" is turned off.',
        },
      });

      const error = await refusal(
        operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      );

      expect(error.reason).toBe("plugin_off");
      expect(sent).toEqual([]);
    });

    it("refuses an operation's requests once it ended, and aborts those in flight", async () => {
      let started!: () => void;
      const reached = new Promise<void>((resolve) => (started = resolve));
      const { operation } = setup({
        respond: (request) =>
          new Promise((_, reject) => {
            started();
            request.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      });
      const broker = operation();

      const inFlight = broker.http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });
      await reached;
      broker.close();

      await expect(inFlight).rejects.toMatchObject({
        code: "refused",
        reason: "operation_ended",
      });
      await expect(
        broker.http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      ).rejects.toMatchObject({ reason: "operation_ended" });
    });
  });

  describe("the address and the endpoint allowlist", () => {
    it("keeps the base address's path and never climbs above it", async () => {
      const { operation, sent } = setup({
        connections: {
          "ajc-jira": [
            jiraConnection(
              {},
              { baseUrl: "https://tfs.acme.com/tfs/DefaultCollection/" },
            ),
          ],
        },
      });
      const broker = operation();

      await broker.http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/issue/ENG-1",
      });
      for (const path of [
        "/rest/api/3/issue/..",
        "/rest/api/3/issue/%2e%2e",
        "/rest/api/3/issue/%252e%252e",
        "/rest/api/3/issue/a%2Fb",
        "/rest/api/3/issue/a%5Cb",
        "/rest/api/3/issue/a;b",
        "/rest/api/3/issue/%00",
        "/rest/api/3/issue/．．",
        "/rest/api/3/issue/",
        "rest/api/3/myself",
        "https://evil.example.com/rest/api/3/myself",
        "//evil.example.com/rest/api/3/myself",
        "/../rest/api/3/myself",
      ]) {
        const error = await refusal(
          broker.http({ connectionId: "jira_1", method: "GET", path }),
        );
        expect(error.reason, path).toBe("not_allowed");
      }

      expect(sent.map((request) => request.url)).toEqual([
        "https://tfs.acme.com/tfs/DefaultCollection/rest/api/3/issue/ENG-1",
      ]);
    });

    it("matches one segment with * and the rest with **, and the method exactly", async () => {
      const { operation, sent } = setup();
      const broker = operation();

      await broker.http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/attachment/content/10001/thumbnail",
      });
      const twoSegments = await refusal(
        broker.http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/issue/ENG-1/comment",
        }),
      );
      const wrongMethod = await refusal(
        broker.http({
          connectionId: "jira_1",
          method: "DELETE",
          path: "/rest/api/3/issue/ENG-1",
        }),
      );
      const unknownMethod = await refusal(
        broker.http({
          connectionId: "jira_1",
          method: "TRACE" as "GET",
          path: "/rest/api/3/myself",
        }),
      );

      expect(twoSegments.reason).toBe("not_allowed");
      expect(wrongMethod.reason).toBe("not_allowed");
      expect(unknownMethod.reason).toBe("invalid_request");
      expect(sent).toHaveLength(1);
    });

    it("refuses a saved address that isn't https, or holds a user name, unless on-premises allows http", async () => {
      for (const [baseUrl, onPremises, allowed] of [
        ["http://jira.acme.com", false, false],
        ["https://user:pass@jira.acme.com", false, false],
        ["ftp://jira.acme.com", true, false],
        ["not an address", false, false],
        ["http://jira.acme.lan", true, true],
      ] as const) {
        const { operation, sent } = setup({
          connections: {
            "ajc-jira": [jiraConnection({ onPremises }, { baseUrl })],
          },
        });
        const result = operation()
          .http({
            connectionId: "jira_1",
            method: "GET",
            path: "/rest/api/3/myself",
          })
          .then(
            () => "sent",
            (error: BrokerRequestError) => error.reason,
          );
        expect(await result, baseUrl).toBe(
          allowed ? "sent" : "invalid_address",
        );
        expect(sent).toHaveLength(allowed ? 1 : 0);
      }
    });

    it("builds a derived host's address from the saved one, with its own endpoints", async () => {
      const azure = manifest({
        id: "ajc-azure-devops",
        network: {
          auth: { scheme: "patBasic", secretField: "apiToken" },
          baseAddress: { field: "baseUrl" },
          endpoints: [{ method: "POST", path: "/*/_apis/wit/wiql" }],
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
              endpoints: [{ method: "GET", path: "/_apis/identities" }],
            },
          ],
          requestHeaders: [],
        },
        connectionAccess: [],
      });
      const { operation, sent } = setup({
        manifest: azure,
        connections: {
          "ajc-jira": [
            jiraConnection({}, { baseUrl: "https://dev.azure.com/acme" }),
            jiraConnection(
              { id: "old_1" },
              { baseUrl: "https://acme.visualstudio.com" },
            ),
            jiraConnection(
              { id: "server_1" },
              { baseUrl: "https://tfs.acme.com/tfs" },
            ),
          ],
        },
      });
      const broker = operation();

      await broker.http({
        connectionId: "jira_1",
        host: "vssps",
        method: "GET",
        path: "/_apis/identities",
        query: { searchFilter: "General" },
      });
      await broker.http({
        connectionId: "old_1",
        host: "vssps",
        method: "GET",
        path: "/_apis/identities",
      });
      const onBase = await refusal(
        broker.http({
          connectionId: "jira_1",
          method: "GET",
          path: "/_apis/identities",
        }),
      );
      const unknownHost = await refusal(
        broker.http({
          connectionId: "jira_1",
          host: "graph",
          method: "GET",
          path: "/_apis/identities",
        }),
      );
      const noForm = await refusal(
        broker.http({
          connectionId: "server_1",
          host: "vssps",
          method: "GET",
          path: "/_apis/identities",
        }),
      );

      expect(sent.map((request) => request.url)).toEqual([
        "https://vssps.dev.azure.com/acme/_apis/identities?searchFilter=General",
        "https://acme.vssps.visualstudio.com/_apis/identities",
      ]);
      expect(sent[0]!.headers.authorization).toBe(
        `Basic ${Buffer.from(`:${TOKEN}`).toString("base64")}`,
      );
      expect([onBase.reason, unknownHost.reason, noForm.reason]).toEqual([
        "not_allowed",
        "not_allowed",
        "not_allowed",
      ]);
    });
  });

  describe("headers", () => {
    it("lets through the headers the manifest lists, and the fixed denylist always wins", async () => {
      const { operation, sent } = setup();
      const broker = operation();

      await broker.http({
        connectionId: "jira_1",
        method: "POST",
        path: "/rest/api/3/search/jql",
        headers: { "content-type": "application/json", ACCEPT: "*/*" },
        body: '{"jql":"project = ENG"}',
      });
      for (const name of [
        "Authorization",
        "Cookie",
        "Host",
        "Forwarded",
        "X-Forwarded-For",
        "Proxy-Authorization",
        "X-HTTP-Method-Override",
        "X-Original-URL",
        "Transfer-Encoding",
        "X-Custom",
      ]) {
        const error = await refusal(
          broker.http({
            connectionId: "jira_1",
            method: "GET",
            path: "/rest/api/3/myself",
            headers: { [name]: "x" },
          }),
        );
        expect(error.reason, name).toBe("header_refused");
      }
      const lineBreak = await refusal(
        broker.http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
          headers: { Accept: "a\r\nAuthorization: Basic x" },
        }),
      );

      expect(lineBreak.reason).toBe("invalid_request");
      expect(sent).toHaveLength(1);
      expect(sent[0]!.headers).toMatchObject({
        "content-type": "application/json",
        accept: "*/*",
      });
      expect(text(sent[0]!.body!)).toBe('{"jql":"project = ENG"}');
    });

    it("refuses the header a header template sets", async () => {
      const base = manifest();
      const { operation } = setup({
        manifest: manifest({
          network: {
            ...base.network,
            auth: {
              scheme: "headerTemplate",
              header: "X-Api-Key",
              template: "{secret}",
              secretField: "apiToken",
            },
          },
        }),
      });

      const error = await refusal(
        operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
          headers: { "x-api-key": "mine" },
        }),
      );

      expect(error.reason).toBe("header_refused");
    });

    it("strips cookies, challenges and any header that echoes a secret from the answer", async () => {
      const { operation } = setup({
        respond: () => ({
          headers: {
            "content-type": "text/plain",
            "set-cookie": "session=1",
            "www-authenticate": 'Basic realm="x"',
            "x-echo": `token ${TOKEN}`,
            "x-echo-encoded": encodeURIComponent(TOKEN),
            "x-request-id": "r-1",
          },
        }),
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });

      expect(response.headers).toEqual({
        "content-type": "text/plain",
        "x-request-id": "r-1",
      });
    });
  });

  describe("redirects", () => {
    it("follows same-origin redirects with the credential, up to 3, then hands the next back", async () => {
      let hops = 0;
      const { operation, sent } = setup({
        respond: () => {
          hops += 1;
          return {
            status: 302,
            headers: { location: `/rest/api/3/issue/ENG-${hops + 1}` },
          };
        },
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/issue/ENG-1",
      });

      expect(sent.map((request) => request.url)).toEqual([
        "https://acme.atlassian.net/rest/api/3/issue/ENG-1",
        "https://acme.atlassian.net/rest/api/3/issue/ENG-2",
        "https://acme.atlassian.net/rest/api/3/issue/ENG-3",
        "https://acme.atlassian.net/rest/api/3/issue/ENG-4",
      ]);
      expect(sent.every((request) => request.headers.authorization)).toBe(true);
      expect(response).toMatchObject({
        status: 302,
        headers: { location: "/rest/api/3/issue/ENG-5" },
      });
    });

    it("hands a cross-origin redirect back with its Location, without following or sending the credential", async () => {
      const { operation, sent } = setup({
        respond: () => ({
          status: 307,
          headers: { location: "https://elsewhere.example.net/collect" },
        }),
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });

      expect(sent).toHaveLength(1);
      expect(response).toMatchObject({
        status: 307,
        headers: { location: "https://elsewhere.example.net/collect" },
      });
    });

    it("hands back a same-origin redirect that climbs above the saved address's path", async () => {
      const { operation, sent } = setup({
        connections: {
          "ajc-jira": [
            jiraConnection({}, { baseUrl: "https://acme.com/jira" }),
          ],
        },
        respond: () => ({ status: 301, headers: { location: "/admin" } }),
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });

      expect(sent).toHaveLength(1);
      expect(response.status).toBe(301);
    });

    it("hands back a same-origin redirect to an address that holds a user name or password", async () => {
      const { operation, sent } = setup({
        respond: (request) => {
          if (!request.url.endsWith("/myself")) return { status: 200 };
          const location = new URL("/rest/api/3/issue/ENG-5", request.url);
          location.username = "me";
          location.password = "pw";
          return { status: 302, headers: { location: location.href } };
        },
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });

      expect(sent).toHaveLength(1);
      expect(response.status).toBe(302);
    });

    it("hands back a same-origin redirect to a path the manifest doesn't allow", async () => {
      for (const location of [
        "/rest/api/3/serverInfo",
        "/rest/api/3/issue/ENG-1/../../admin",
        "/rest/api/3/issue/ENG-1;jsessionid=1",
        "/rest/api/3/issue/ENG-1/comment",
      ]) {
        const { operation, sent } = setup({
          respond: (request) =>
            request.url.endsWith("/myself")
              ? { status: 302, headers: { location } }
              : { status: 200 },
        });

        const response = await operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
        });

        expect(sent, location).toHaveLength(1);
        expect(response, location).toMatchObject({
          status: 302,
          headers: { location },
        });
      }
    });

    it("follows a same-origin redirect only to an endpoint whose access choice is on", async () => {
      const editing = manifest({
        network: {
          ...manifest().network,
          endpoints: [
            { method: "PUT", path: "/rest/api/3/issue/ENG-1" },
            {
              method: "PUT",
              path: "/rest/api/3/issue/*",
              access: "editIssues",
            },
          ],
        },
      });
      const respond = (request: BrokerTransportRequest) =>
        request.url.endsWith("/ENG-1")
          ? { status: 307, headers: { location: "/rest/api/3/issue/ENG-2" } }
          : { status: 200 };
      const off = setup({ manifest: editing, respond });
      const on = setup({
        manifest: editing,
        respond,
        connections: {
          "ajc-jira": [jiraConnection({ access: ["editIssues"] })],
        },
      });
      const put = {
        connectionId: "jira_1",
        method: "PUT" as const,
        path: "/rest/api/3/issue/ENG-1",
        body: "{}",
      };

      const handedBack = await off.operation().http(put);
      const followed = await on.operation().http(put);

      expect(handedBack.status).toBe(307);
      expect(off.sent).toHaveLength(1);
      expect(followed.status).toBe(200);
      expect(on.sent.map((request) => request.url)).toEqual([
        "https://acme.atlassian.net/rest/api/3/issue/ENG-1",
        "https://acme.atlassian.net/rest/api/3/issue/ENG-2",
      ]);
    });

    it("turns a POST into a GET after a 303, without its body", async () => {
      const { operation, sent } = setup({
        respond: (request) =>
          request.method === "POST"
            ? { status: 303, headers: { location: "/rest/api/3/myself" } }
            : { status: 200 },
      });

      await operation().http({
        connectionId: "jira_1",
        method: "POST",
        path: "/rest/api/3/search/jql",
        body: "{}",
      });

      expect(sent.map((request) => [request.method, request.body])).toEqual([
        ["POST", bytes("{}")],
        ["GET", undefined],
      ]);
    });
  });

  describe("a secret address", () => {
    const feedAddress =
      "webcal://calendar.example.org/feeds/9d1c4b7e/basic.ics";
    const ics = manifest({
      id: "ajc-ics",
      connectionFields: [
        {
          id: "feedUrl",
          label: "Feed address",
          type: "password",
          required: true,
          secret: true,
        },
      ],
      capabilities: { calendar: {} },
      network: {
        auth: { scheme: "secretAddress", secretField: "feedUrl" },
      },
      connectionAccess: [],
    });
    const feed = (overrides: Partial<BrokerConnection> = {}) =>
      jiraConnection({
        values: { feedUrl: feedAddress },
        secrets: [feedAddress],
        ...overrides,
      });

    it("fetches the address with an empty path, following https redirects to any host up to 3, and never gives the address away", async () => {
      const { operation, sent } = setup({
        manifest: ics,
        connections: { "ajc-jira": [feed()] },
        respond: (request): Partial<BrokerTransportResponse> => {
          const hop = sent.length;
          if (hop < 4) {
            return {
              status: 302,
              headers: { location: `https://cdn${hop}.example.net/feed.ics` },
            };
          }
          return {
            status: 200,
            headers: {
              "content-type": "text/calendar",
              "content-location": request.url,
            },
            body: bytes(
              `BEGIN:VCALENDAR\nURL:${feedAddress}\nSOURCE:${request.url}\nEND:VCALENDAR`,
            ),
          };
        },
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "",
      });

      expect(sent.map((request) => request.url)).toEqual([
        "https://calendar.example.org/feeds/9d1c4b7e/basic.ics",
        "https://cdn1.example.net/feed.ics",
        "https://cdn2.example.net/feed.ics",
        "https://cdn3.example.net/feed.ics",
      ]);
      expect(response.status).toBe(200);
      expect(response.headers).toEqual({ "content-type": "text/calendar" });
      // The address it ended at often carries a token of its own.
      expect(text(response.body)).toBe(
        "BEGIN:VCALENDAR\nURL:[secret]\nSOURCE:[secret]\nEND:VCALENDAR",
      );
    });

    it("refuses, through a proxy that answers for any name, a redirect to a name no public DNS holds", async () => {
      const throughProxy = {
        async resolve() {
          return { addresses: [], proxied: true };
        },
      };
      for (const target of [
        "https://intranet/",
        "https://wiki.corp.local/",
        "https://build.internal/feed.ics",
        "https://nas.lan/",
        "https://router.home.arpa/",
        "https://localhost/",
      ]) {
        const { operation, sent } = setup({
          manifest: ics,
          connections: { "ajc-jira": [feed()] },
          resolver: throughProxy,
          respond: () => ({ status: 302, headers: { location: target } }),
        });

        const error = await refusal(
          operation().http({ connectionId: "jira_1", method: "GET", path: "" }),
        );

        expect(error.reason, target).toBe("private_address");
        expect(sent, target).toHaveLength(1);
      }
    });

    it("follows, through a proxy, a redirect to a public domain name", async () => {
      const { operation, sent } = setup({
        manifest: ics,
        connections: { "ajc-jira": [feed()] },
        resolver: {
          async resolve() {
            return { addresses: [], proxied: true };
          },
        },
        respond: () =>
          sent.length === 1
            ? {
                status: 302,
                headers: { location: "https://cdn.example.net/feed.ics" },
              }
            : { status: 200 },
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "",
      });

      expect(response.status).toBe(200);
      expect(sent.map((request) => request.url)).toEqual([
        "https://calendar.example.org/feeds/9d1c4b7e/basic.ics",
        "https://cdn.example.net/feed.ics",
      ]);
    });

    it("reaches a local name through a proxy for a connection marked on-premises", async () => {
      const { operation, sent } = setup({
        connections: {
          "ajc-jira": [
            jiraConnection(
              { onPremises: true },
              { baseUrl: "https://intranet" },
            ),
          ],
        },
        resolver: {
          async resolve() {
            return { addresses: [], proxied: true };
          },
        },
        respond: () => ({ status: 200 }),
      });

      await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });

      expect(sent[0]!.url).toBe("https://intranet/rest/api/3/myself");
    });

    it("refuses a fourth redirect, or one away from https, rather than hand the 3xx back", async () => {
      const always = setup({
        manifest: ics,
        connections: { "ajc-jira": [feed()] },
        respond: () => ({
          status: 302,
          headers: { location: "https://loop.example.net/feed.ics" },
        }),
      });
      const plain = setup({
        manifest: ics,
        connections: { "ajc-jira": [feed()] },
        respond: () => ({
          status: 302,
          headers: { location: "http://plain.example.net/feed.ics" },
        }),
      });

      const tooMany = await refusal(
        always
          .operation()
          .http({ connectionId: "jira_1", method: "GET", path: "" }),
      );
      const insecure = await refusal(
        plain
          .operation()
          .http({ connectionId: "jira_1", method: "GET", path: "" }),
      );

      expect(tooMany.reason).toBe("redirect_refused");
      expect(always.sent).toHaveLength(4);
      expect(insecure.reason).toBe("redirect_refused");
      expect(`${tooMany.message} ${insecure.message}`).not.toContain("example");
    });

    it("refuses a saved address that holds a user name or password, whatever its scheme, before any request, without naming it", async () => {
      for (const address of [
        "https://me:pw@calendar.example.org/feeds/9d1c4b7e/basic.ics",
        "https://me@calendar.example.org/feeds/9d1c4b7e/basic.ics",
        "webcal://me:pw@calendar.example.org/feeds/9d1c4b7e/basic.ics",
        "WEBCALS://me:pw@calendar.example.org/feeds/9d1c4b7e/basic.ics",
      ]) {
        const { operation, sent } = setup({
          manifest: ics,
          connections: {
            "ajc-jira": [
              feed({ values: { feedUrl: address }, secrets: [address] }),
            ],
          },
        });

        const error = await refusal(
          operation().http({ connectionId: "jira_1", method: "GET", path: "" }),
        );

        expect(error.reason, address).toBe("invalid_address");
        expect(error.message, address).toContain("user name or password");
        expect(error.message, address).not.toMatch(
          /\bme\b|pw|example|9d1c4b7e/,
        );
        expect(sent, address).toEqual([]);
      }
    });

    it("refuses a redirect to an address that holds a user name or password, rather than send it", async () => {
      // A redirect target is held to the rule of the saved address: the
      // user name and password would ride along on the next request.
      for (const location of [
        "https://me:pw@cdn.example.net/feed.ics",
        "https://me@cdn.example.net/feed.ics",
        "//me:pw@cdn.example.net/feed.ics",
      ]) {
        const { operation, sent } = setup({
          manifest: ics,
          connections: { "ajc-jira": [feed()] },
          respond: () => ({ status: 302, headers: { location } }),
        });

        const error = await refusal(
          operation().http({ connectionId: "jira_1", method: "GET", path: "" }),
        );

        expect(error.reason, location).toBe("redirect_refused");
        expect(error.message, location).toContain("user name or password");
        expect(error.message, location).not.toMatch(/\bme\b|pw|example/);
        expect(sent, location).toHaveLength(1);
      }
    });

    it("takes only a GET with an empty path and no query", async () => {
      const { operation, sent } = setup({
        manifest: ics,
        connections: { "ajc-jira": [feed()] },
      });
      const broker = operation();

      for (const request of [
        { method: "GET" as const, path: "/other" },
        { method: "POST" as const, path: "" },
        { method: "GET" as const, path: "", query: { a: "1" } },
        { method: "GET" as const, path: "", host: "cdn" },
      ]) {
        const error = await refusal(
          broker.http({ connectionId: "jira_1", ...request }),
        );
        expect(error.reason).toBe("not_allowed");
      }
      expect(sent).toEqual([]);
    });

    it("refuses a redirect to an address too long to scrub, rather than follow it", async () => {
      const huge = `https://cdn.example.net/${"Zx81kQ-77/".repeat(500)}feed.ics`;
      const { operation, sent } = setup({
        manifest: ics,
        connections: { "ajc-jira": [feed()] },
        respond: () => ({ status: 302, headers: { location: huge } }),
      });

      const error = await refusal(
        operation().http({ connectionId: "jira_1", method: "GET", path: "" }),
      );

      expect(error.reason).toBe("redirect_refused");
      expect(error.message).toContain("too long");
      expect(sent).toHaveLength(1);
    });

    describe("scrubs the forms a server echoes it in", () => {
      const address =
        "https://calendar.example.org/private-abc123/basic.ics?a=1&token=s3cr3t";
      const redirected = "https://cdn.example.net/signed/Zx81kQ/feed.ics";
      const cases: [string, string, string][] = [
        [
          "its path and query alone",
          "Cannot GET /private-abc123/basic.ics?a=1&token=s3cr3t",
          "Cannot GET [secret]",
        ],
        [
          "HTML-escaped",
          '<a href="https://calendar.example.org/private-abc123/basic.ics?a=1&amp;token=s3cr3t">',
          '<a href="[secret]">',
        ],
        [
          "with an uppercase host",
          "at HTTPS://CALENDAR.EXAMPLE.ORG/private-abc123/basic.ics?a=1&token=s3cr3t.",
          "at [secret].",
        ],
        [
          "JSON-escaped, & as \\u0026",
          '{"u":"https:\\/\\/calendar.example.org\\/private-abc123\\/basic.ics?a=1\\u0026token=s3cr3t"}',
          '{"u":"[secret]"}',
        ],
        [
          "one path segment",
          "No calendar private-abc123 here",
          "No calendar [secret] here",
        ],
        [
          "a credential's query value",
          "token s3cr3t expired",
          "token [secret] expired",
        ],
        [
          "where it redirected to, by its path",
          "moved from /signed/Zx81kQ/feed.ics",
          "moved from [secret]",
        ],
        [
          "but not a common word of it",
          "basic.ics and calendar.example.org",
          "basic.ics and calendar.example.org",
        ],
      ];

      it.each(cases)("%s", async (_name, echo, scrubbed) => {
        const { operation } = setup({
          manifest: ics,
          connections: {
            "ajc-jira": [
              feed({ values: { feedUrl: address }, secrets: [address] }),
            ],
          },
          respond: (request) =>
            request.url === address
              ? { status: 302, headers: { location: redirected } }
              : { status: 200, body: bytes(echo) },
        });

        const response = await operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "",
        });

        expect(text(response.body)).toBe(scrubbed);
      });
    });
  });

  describe("private addresses", () => {
    const request = {
      connectionId: "jira_1",
      method: "GET" as const,
      path: "/rest/api/3/myself",
    };

    it("refuses a host that resolves to a private address of any kind, before sending", async () => {
      for (const address of [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.9",
        "192.168.1.20",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "fd12:3456::1",
        "fe80::1",
        "::ffff:8.8.8.8",
        "64:ff9b::a00:1",
        "not-an-address",
      ]) {
        const { operation, sent } = setup({
          resolver: fakeResolver({
            "acme.atlassian.net": ["151.101.1.69", address],
          }),
        });
        const error = await refusal(operation().http(request));
        expect(error.reason, address).toBe("private_address");
        expect(sent).toEqual([]);
      }
    });

    it("refuses an address literal that is private", async () => {
      for (const baseUrl of [
        "https://127.0.0.1",
        "https://[::1]",
        "https://[::ffff:7f00:1]",
        "https://2130706433",
      ]) {
        const { operation, sent } = setup({
          connections: { "ajc-jira": [jiraConnection({}, { baseUrl })] },
        });
        const error = await refusal(operation().http(request));
        expect(error.reason, baseUrl).toBe("private_address");
        expect(sent).toEqual([]);
      }
    });

    it("drops the answer of a host that rebound to a private address after it was checked", async () => {
      const { operation, sent, activity } = setup({
        respond: () => ({
          status: 200,
          body: bytes("internal admin page"),
          remoteAddress: "192.168.0.1",
        }),
      });

      const error = await refusal(operation().http(request));

      expect(sent).toHaveLength(1);
      expect(error.reason).toBe("private_address");
      expect(error.message).not.toContain("admin");
      expect(activity).toEqual([
        { kind: "blocked", pluginId: "ajc-jira", connectionId: "jira_1" },
      ]);
    });

    it("checks each redirect's host again", async () => {
      const { operation, sent } = setup({
        resolver: {
          // The second answer for the same name is private: a rebinding.
          async resolve() {
            return {
              addresses: sent.length === 0 ? ["151.101.1.69"] : ["10.0.0.7"],
            };
          },
        },
        respond: () => ({
          status: 302,
          headers: { location: "/rest/api/3/issue/ENG-1" },
        }),
      });

      const error = await refusal(operation().http(request));

      expect(error.reason).toBe("private_address");
      expect(sent).toHaveLength(1);
    });

    it("reaches private addresses for a connection marked on-premises", async () => {
      const { operation, sent } = setup({
        connections: {
          "ajc-jira": [
            jiraConnection(
              { onPremises: true },
              { baseUrl: "http://10.0.0.5:8080/jira" },
            ),
          ],
        },
        respond: () => ({ status: 200, remoteAddress: "10.0.0.5" }),
      });

      const response = await operation().http(request);

      expect(response.status).toBe(200);
      expect(sent[0]!.url).toBe("http://10.0.0.5:8080/jira/rest/api/3/myself");
    });

    it("sends through a proxy that resolves the host itself, and doesn't judge the proxy's address", async () => {
      const { operation, sent } = setup({
        resolver: fakeResolver({ "acme.atlassian.net": [] }, { proxied: true }),
        respond: () => ({ status: 200, remoteAddress: "10.20.0.1" }),
      });

      await expect(operation().http(request)).resolves.toMatchObject({
        status: 200,
      });
      expect(sent).toHaveLength(1);
    });

    it("judges the address that answered a proxied request when it isn't the proxy's, as when a PAC file falls back to DIRECT", async () => {
      const proxied = (remoteAddress: string) =>
        setup({
          resolver: {
            async resolve() {
              return {
                addresses: ["151.101.1.69"],
                proxied: true,
                proxyAddresses: ["10.20.0.1"],
              };
            },
          },
          respond: () => ({ status: 200, remoteAddress }),
        });
      const throughProxy = proxied("10.20.0.1");
      const direct = proxied("192.168.1.20");

      await expect(
        throughProxy.operation().http(request),
      ).resolves.toMatchObject({ status: 200 });
      const error = await refusal(direct.operation().http(request));

      expect(throughProxy.requestEvents()[0]).toMatchObject({
        broker: { answer_address: "proxy" },
      });
      expect(error.reason).toBe("private_address");
    });

    it("says in the event when nothing told it which address answered", async () => {
      const unknown = setup({ respond: () => ({ status: 200 }) });
      const known = setup({
        respond: () => ({ status: 200, remoteAddress: "151.101.1.69" }),
      });

      await unknown.operation().http(request);
      await known.operation().http(request);

      expect(unknown.requestEvents()[0]).toMatchObject({
        outcome: "ok",
        broker: { answer_address: "unknown" },
      });
      expect(known.requestEvents()[0]).toMatchObject({
        broker: { answer_address: "checked" },
      });
    });

    it("fails with a network error when the host doesn't resolve", async () => {
      const { operation, sent } = setup({
        resolver: {
          async resolve() {
            throw new Error(
              `getaddrinfo ENOTFOUND acme.atlassian.net ${TOKEN}`,
            );
          },
        },
      });

      const error = await refusal(operation().http(request));

      expect(error).toMatchObject({ code: "network", reason: "network" });
      expect(error.message).not.toContain(TOKEN);
      expect(sent).toEqual([]);
    });
  });

  describe("limits", () => {
    const request = {
      connectionId: "jira_1",
      method: "POST" as const,
      path: "/rest/api/3/search/jql",
    };

    it("refuses a request body over the limit, and stops a response over its own", async () => {
      const { operation, sent } = setup({
        limits: { requestBodyBytes: 10, responseBodyBytes: 20 },
        respond: (sentRequest) => {
          expect(sentRequest.maxResponseBytes).toBe(20);
          throw Object.assign(new Error("too large"), {
            code: "response_too_large",
          });
        },
      });

      const large = await refusal(
        operation().http({ ...request, body: "x".repeat(11) }),
      );
      const answer = await refusal(
        operation().http({ ...request, body: "{}" }),
      );

      expect(large).toMatchObject({
        code: "limit",
        reason: "request_too_large",
      });
      expect(answer).toMatchObject({
        code: "limit",
        reason: "response_too_large",
      });
      expect(sent).toHaveLength(1);
    });

    it("refuses requests past the plugin's rate, and lets them through again as it refills", async () => {
      let now = 1_000_000;
      const { operation, sent } = setup({
        limits: { rateBurst: 3, ratePerSecond: 2 },
        now: () => now,
      });
      const broker = operation();

      for (let index = 0; index < 3; index += 1) await broker.http(request);
      const limited = await refusal(broker.http(request));
      now += 500;
      await broker.http(request);

      expect(limited).toMatchObject({ code: "limit", reason: "rate_limited" });
      expect(sent).toHaveLength(4);
    });

    it("keeps a plugin to its requests in flight, queues the rest, and refuses past the queue", async () => {
      const releases: (() => void)[] = [];
      let inFlight = 0;
      let most = 0;
      const { operation } = setup({
        limits: { concurrentPerPlugin: 2, queuedPerPlugin: 1 },
        respond: () =>
          new Promise((resolve) => {
            inFlight += 1;
            most = Math.max(most, inFlight);
            releases.push(() => {
              inFlight -= 1;
              resolve({ status: 200 });
            });
          }),
      });
      const broker = operation();

      const sending = [
        broker.http(request),
        broker.http(request),
        broker.http(request),
      ];
      await waitUntil(() => releases.length === 2);
      const overflow = await refusal(broker.http(request));
      while (releases.length > 0 || inFlight > 0) {
        releases.shift()?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await Promise.all(sending);

      expect(overflow).toMatchObject({
        code: "limit",
        reason: "too_many_queued",
      });
      expect(most).toBe(2);
    });

    it("drops an answer it can't check for secrets", async () => {
      // Forms past what one redaction may hold: no real field is this long.
      const huge = "k".repeat(1_000_000);
      const { operation, requestEvents } = setup({
        connections: {
          "ajc-jira": [jiraConnection({ secrets: [huge] }, { apiToken: huge })],
        },
        respond: () => ({ status: 200, body: bytes("{}") }),
      });

      const error = await refusal(
        operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      );

      expect(error).toMatchObject({
        code: "limit",
        reason: "unchecked_response",
      });
      expect(requestEvents()[0]).toMatchObject({
        outcome: "refused",
        outcome_reason: "unchecked_response",
      });
    });

    it("ends a request that takes too long with a timeout", async () => {
      const { operation, requestEvents } = setup({
        limits: { timeoutMs: 20 },
        respond: (sentRequest) =>
          new Promise((_, reject) =>
            sentRequest.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      });

      const error = await refusal(operation().http(request));

      expect(error).toMatchObject({ code: "timeout", reason: "timeout" });
      expect(requestEvents()[0]).toMatchObject({
        outcome: "timeout",
        outcome_reason: "timeout",
      });
    });

    it("aborts a request when the plugin's signal fires, as fetch does", async () => {
      const controller = new AbortController();
      let transportSignal: AbortSignal | undefined;
      const { operation, requestEvents } = setup({
        respond: (sentRequest) =>
          new Promise((_, reject) => {
            transportSignal = sentRequest.signal;
            controller.abort();
            sentRequest.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
            if (sentRequest.signal.aborted) reject(new Error("aborted"));
          }),
      });

      const error = await operation()
        .http({ ...request, signal: controller.signal })
        .catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({ name: "AbortError" });
      expect(transportSignal?.aborted).toBe(true);
      expect(requestEvents()[0]).toMatchObject({
        outcome: "cancelled",
        outcome_reason: "aborted",
      });
    });
  });

  describe("scrubbing", () => {
    it("removes the secret and its changed forms from the body, whatever its type", async () => {
      const pair = `ada@acme.test:${TOKEN}`;
      const echoes = [
        TOKEN,
        encodeURIComponent(TOKEN),
        encodeURIComponent(TOKEN).replace(/%[0-9A-F]{2}/g, (hex) =>
          hex.toLowerCase(),
        ),
        JSON.stringify(TOKEN).slice(1, -1).replaceAll("/", "\\/"),
        Buffer.from(TOKEN).toString("base64"),
        Buffer.from(pair).toString("base64"),
        pair,
      ];
      const { operation } = setup({
        respond: () => ({
          headers: { "content-type": "application/octet-stream" },
          body: bytes(echoes.map((echo) => `<${echo}>`).join("")),
        }),
      });

      const response = await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });

      const body = text(response.body);
      expect(body).toBe(echoes.map(() => "<[secret]>").join(""));
      for (const echo of echoes) expect(body).not.toContain(echo);
    });

    it("leaves an error free of the secret, even when the transport's names the address", async () => {
      const { operation, requestEvents } = setup({
        respond: () => {
          throw new Error(
            `net::ERR_CONNECTION_RESET at https://acme.atlassian.net/?t=${TOKEN}`,
          );
        },
      });

      const error = await refusal(
        operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
        }),
      );

      expect(error).toMatchObject({
        code: "network",
        message: "The service couldn't be reached.",
      });
      expect(JSON.stringify(requestEvents())).not.toContain(TOKEN);
    });
  });

  describe("connection access", () => {
    it("allows an endpoint behind an access choice only while the connection has it on", async () => {
      const off = setup();
      const on = setup({
        connections: {
          "ajc-jira": [jiraConnection({ access: ["editIssues"] })],
        },
      });
      const write = {
        connectionId: "jira_1",
        method: "PUT" as const,
        path: "/rest/api/3/issue/ENG-1",
        body: "{}",
      };

      const refused = await refusal(off.operation().http(write));
      await on.operation().http(write);

      expect(refused).toMatchObject({
        reason: "access_off",
        message:
          "This connection's access doesn't include \"Edit issues\". Turn it on in the connection's settings.",
      });
      expect(off.sent).toEqual([]);
      expect(on.sent).toHaveLength(1);
      expect(off.activity).toEqual([
        { kind: "blocked", pluginId: "ajc-jira", connectionId: "jira_1" },
      ]);
    });

    it("keeps an always-on choice's endpoints and POST reads without a choice open", async () => {
      const { operation, sent } = setup();
      const broker = operation();

      await broker.http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/field",
      });
      await broker.http({
        connectionId: "jira_1",
        method: "POST",
        path: "/rest/api/3/search/jql",
        body: "{}",
      });

      expect(sent).toHaveLength(2);
    });

    it("keeps two connections on one token apart: only the editing one writes, only in its own organisation, and reads sent as POST pass", async () => {
      const azure = manifest({
        id: "ajc-azure-devops",
        network: {
          auth: { scheme: "patBasic", secretField: "apiToken" },
          baseAddress: { field: "baseUrl" },
          endpoints: [
            { method: "POST", path: "/*/_apis/wit/wiql" },
            {
              method: "PATCH",
              path: "/_apis/wit/workitems/*",
              access: "editWorkItems",
            },
          ],
          requestHeaders: ["Content-Type"],
        },
        connectionAccess: [
          { id: "readBacklog", label: "Read the backlog", always: true },
          {
            id: "editWorkItems",
            label: "Edit work items",
            operations: ["writeSettle"],
          },
        ],
      });
      const { operation, sent } = setup({
        manifest: azure,
        connections: {
          "ajc-azure-devops": [
            jiraConnection(
              { id: "contoso" },
              { baseUrl: "https://dev.azure.com/contoso" },
            ),
            jiraConnection(
              { id: "fabrikam", access: ["editWorkItems"] },
              { baseUrl: "https://dev.azure.com/fabrikam" },
            ),
          ],
        },
      });
      const broker = operation("ajc-azure-devops");
      const patch = (connectionId: string, path = "/_apis/wit/workitems/1") =>
        broker.http({ connectionId, method: "PATCH", path, body: "[]" });

      const readOnly = await refusal(patch("contoso"));
      await broker.http({
        connectionId: "contoso",
        method: "POST",
        path: "/Platform/_apis/wit/wiql",
        body: "{}",
      });
      await patch("fabrikam");
      const climbing = await refusal(
        patch("fabrikam", "/../contoso/_apis/wit/workitems/1"),
      );

      expect(readOnly.reason).toBe("access_off");
      expect(climbing.reason).not.toBe("access_off");
      expect(sent.map((request) => [request.method, request.url])).toEqual([
        ["POST", "https://dev.azure.com/contoso/Platform/_apis/wit/wiql"],
        ["PATCH", "https://dev.azure.com/fabrikam/_apis/wit/workitems/1"],
      ]);
    });

    it("reads the connection's access at dispatch, so a choice turned off stops a queued request", async () => {
      const connection = jiraConnection({ access: ["editIssues"] });
      let release!: () => void;
      const { operation, sent } = setup({
        connections: { "ajc-jira": [connection] },
        limits: { concurrentPerPlugin: 1 },
        respond: (request) =>
          request.method === "GET"
            ? new Promise((resolve) => {
                release = () => resolve({ status: 200 });
              })
            : { status: 200 },
      });
      const broker = operation();

      const first = broker.http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/myself",
      });
      const queued = broker.http({
        connectionId: "jira_1",
        method: "PUT",
        path: "/rest/api/3/issue/ENG-1",
      });
      await waitUntil(() => sent.length === 1);
      connection.access = [];
      release();
      await first;

      await expect(queued).rejects.toMatchObject({ reason: "access_off" });
      expect(sent).toHaveLength(1);
    });
  });

  describe("public fetches", () => {
    it("reaches a declared public host over https without a credential", async () => {
      const { operation, sent, requestEvents, activity } = setup({
        respond: () => ({
          status: 200,
          headers: { "content-type": "image/png", "set-cookie": "a=1" },
          body: new Uint8Array([137, 80, 78, 71]),
        }),
      });

      const response = await operation().publicFetch(
        "https://avatars.example-cdn.com/u/1?s=40",
        { headers: { Accept: "image/png" } },
      );

      expect(response).toEqual({
        status: 200,
        headers: { "content-type": "image/png" },
        body: new Uint8Array([137, 80, 78, 71]),
      });
      expect(sent[0]).toMatchObject({
        url: "https://avatars.example-cdn.com/u/1?s=40",
        method: "GET",
        headers: { accept: "image/png" },
      });
      expect(requestEvents()[0]).toMatchObject({
        outcome: "ok",
        broker: { host_kind: "public", status_code: 200 },
      });
      expect(activity).toEqual([{ kind: "request", pluginId: "ajc-jira" }]);
    });

    it("refuses an undeclared host, plain http, another port, a credential header and a private address", async () => {
      const { operation, sent } = setup({
        resolver: fakeResolver({ "avatars.example-cdn.com": ["10.0.0.9"] }),
      });
      const broker = operation();

      const results = await Promise.all(
        [
          broker.publicFetch("https://other.example.com/a.png"),
          broker.publicFetch("http://avatars.example-cdn.com/a.png"),
          broker.publicFetch("https://avatars.example-cdn.com:8443/a.png"),
          broker.publicFetch("https://avatars.example-cdn.com/a.png", {
            headers: { Authorization: "Bearer x" },
          }),
          broker.publicFetch("https://avatars.example-cdn.com/a.png"),
          broker.publicFetch("/relative.png"),
          broker.publicFetch("https://avatars.example-cdn.com/a.png", {
            method: "POST" as "GET",
          }),
        ].map((promise) => refusal(promise).then((error) => error.reason)),
      );

      expect(results).toEqual([
        "not_allowed",
        "not_allowed",
        "not_allowed",
        "header_refused",
        "private_address",
        "invalid_request",
        "invalid_request",
      ]);
      expect(sent).toEqual([]);
    });
  });

  describe("audit", () => {
    it("emits one event per request with the endpoint pattern, never the path, query, headers or body", async () => {
      const { operation, requestEvents, activity } = setup({
        respond: () => ({ status: 201, body: bytes(`{"echo":"${TOKEN}"}`) }),
      });

      await operation().http({
        connectionId: "jira_1",
        method: "GET",
        path: "/rest/api/3/issue/SECRET-PROJECT-42",
        query: { jql: "summary ~ 'confidential'" },
        headers: { Accept: "application/json" },
      });

      const [event] = requestEvents();
      expect(event).toMatchObject({
        name: "plugin.request",
        kind: "job",
        runtime: "api",
        outcome: "ok",
        plugin: { id: "ajc-jira" },
        connection: { id: "jira_1" },
        broker: {
          method: "GET",
          host_kind: "base",
          path_template: "/rest/api/3/issue/*",
          status_code: 201,
          redirects: 0,
          request_bytes: 0,
          on_premises: false,
          pending: false,
        },
      });
      const serialized = JSON.stringify(event);
      for (const content of [
        "SECRET-PROJECT-42",
        "confidential",
        "application/json",
        TOKEN,
        "acme",
      ]) {
        expect(serialized).not.toContain(content);
      }
      expect(activity).toEqual([
        { kind: "request", pluginId: "ajc-jira", connectionId: "jira_1" },
      ]);
    });

    it("counts a policy refusal as a blocked attempt, and a limit or a paused plugin as neither", async () => {
      const { operation, activity } = setup({
        limits: { requestBodyBytes: 1 },
      });

      await refusal(
        operation().http({
          connectionId: "jira_1",
          method: "GET",
          path: "/rest/api/3/myself",
          headers: { Cookie: "a=1" },
        }),
      );
      await refusal(
        operation().http({
          connectionId: "jira_1",
          method: "POST",
          path: "/rest/api/3/search/jql",
          body: "{}",
        }),
      );

      expect(activity).toEqual([
        { kind: "blocked", pluginId: "ajc-jira", connectionId: "jira_1" },
        { kind: "request", pluginId: "ajc-jira" },
      ]);
    });
  });
});

/** Waits until `condition` holds, a turn of the event loop at a time. */
async function waitUntil(condition: () => boolean) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(condition()).toBe(true);
}
