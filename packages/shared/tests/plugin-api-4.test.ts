import { describe, expect, it } from "vitest";
import {
  deriveHostAddress,
  endpointPatternMatches,
  isDeniedRequestHeader,
  pluginApi4ManifestSchema,
  type PluginApi4Manifest,
} from "../plugin-api-4";
import { pluginsOverviewSchema } from "../plugins";
import {
  azureDevOpsManifest,
  gitHubManifest,
  icsManifest,
  jiraManifest,
  workdayAgentManifest,
  workdayShapeManifest,
} from "./fixtures/api-4-manifests";

function issuesOf(manifest: unknown) {
  const result = pluginApi4ManifestSchema.safeParse(manifest);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

function parsed(manifest: unknown): PluginApi4Manifest {
  return pluginApi4ManifestSchema.parse(manifest);
}

describe("the API 4 manifest", () => {
  it.each([
    ["Azure DevOps", azureDevOpsManifest()],
    ["GitHub", gitHubManifest()],
    ["Jira", jiraManifest()],
    ["ICS", icsManifest()],
    ["the Workday data shape", workdayShapeManifest()],
    ["the Workday agent tasks", workdayAgentManifest()],
  ])("expresses %s", (_name, manifest) => {
    expect(issuesOf(manifest)).toEqual([]);
  });

  it("starts a plugin when needed unless it declares otherwise", () => {
    expect(parsed(jiraManifest()).runtime).toEqual({ start: "whenNeeded" });
    expect(parsed(gitHubManifest()).runtime).toEqual({ start: "whenNeeded" });
    expect(parsed(workdayAgentManifest()).runtime).toEqual({
      start: "alwaysReady",
      memoryCeilingMb: 128,
    });
  });

  it.each([63, 2049, 100.5])(
    "refuses a default memory ceiling of %s MB",
    (memoryCeilingMb) => {
      expect(
        issuesOf({ ...jiraManifest(), runtime: { memoryCeilingMb } }),
      ).not.toEqual([]);
    },
  );

  it("needs apiVersion 4", () => {
    expect(issuesOf({ ...jiraManifest(), apiVersion: 3 })).not.toEqual([]);
  });

  it("refuses keys it does not know, so a typo is not silently ignored", () => {
    expect(issuesOf({ ...jiraManifest(), netwrok: {} })).not.toEqual([]);
  });

  describe("secret fields", () => {
    it("refuses a secret field marked as passed to the plugin", () => {
      const manifest = jiraManifest();
      manifest.connectionFields[2] = {
        ...manifest.connectionFields[2]!,
        passToPlugin: true,
      } as (typeof manifest.connectionFields)[number];

      expect(issuesOf(manifest)).toEqual([
        "Secret fields are host-owned: Ajour never passes one to a plugin.",
      ]);
    });

    it("refuses an agent task setting that is secret and passed to the plugin", () => {
      const manifest = workdayAgentManifest();
      const task = manifest.capabilities.agentTask.tasks[0]!;
      task.settings = [
        {
          id: "url",
          label: "Workday URL",
          type: "url",
          required: true,
          secret: true,
          passToPlugin: true,
        } as (typeof task.settings)[number],
      ];

      expect(issuesOf(manifest)).toContain(
        "Secret fields are host-owned: Ajour never passes one to a plugin.",
      );
    });

    it("refuses an auth scheme that names a field that is not secret", () => {
      const manifest = jiraManifest();
      manifest.network.auth = {
        scheme: "basic",
        userField: "email",
        secretField: "email",
      };

      expect(issuesOf(manifest)).toEqual([
        'The auth scheme\'s secret field "email" must be a secret connection field.',
      ]);
    });

    it("refuses an auth scheme that names a missing field", () => {
      const manifest = jiraManifest();
      manifest.network.auth = {
        scheme: "basic",
        userField: "login",
        secretField: "apiToken",
      };

      expect(issuesOf(manifest)).toEqual([
        'The auth scheme\'s user field "login" is not a connection field.',
      ]);
    });
  });

  describe("reserved declarations", () => {
    it("refuses a generated secret field, which is reserved", () => {
      const manifest = jiraManifest();
      manifest.connectionFields[2] = {
        ...manifest.connectionFields[2]!,
        generated: true,
      } as (typeof manifest.connectionFields)[number];

      expect(issuesOf(manifest)).toEqual([
        "Generated secret fields are reserved, and this version of Ajour doesn't support them.",
      ]);
    });

    it("refuses the body-field auth scheme, which is reserved", () => {
      const manifest = jiraManifest();
      (manifest.network as Record<string, unknown>).auth = {
        scheme: "bodyField",
        secretField: "apiToken",
        path: "args[0].secret",
      };

      expect(issuesOf(manifest)).toEqual([
        "The body-field auth scheme is reserved, and this version of Ajour doesn't support it.",
      ]);
    });

    it("refuses a sign-in declaration, which is reserved", () => {
      expect(issuesOf({ ...jiraManifest(), signIn: {} })).toEqual([
        "Sign-in is reserved, and this version of Ajour doesn't support it.",
      ]);
    });

    it("refuses the team capability, which waits for generated secrets", () => {
      const manifest = {
        ...jiraManifest(),
        capabilities: { team: { apiVersion: 1 } },
      };

      expect(issuesOf(manifest)).toEqual([
        "The team capability stays on plugin API 3 until generated secrets ship.",
      ]);
    });
  });

  describe("the base address", () => {
    it("must name a url field that is not secret", () => {
      const manifest = jiraManifest();
      manifest.network.baseAddress = { field: "email" };

      expect(issuesOf(manifest)).toEqual([
        'The base address field "email" must be a url connection field that is not secret.',
      ]);
    });

    it("is needed by an auth scheme that attaches a credential to it", () => {
      const manifest = jiraManifest();
      delete (manifest.network as Record<string, unknown>).baseAddress;
      manifest.network.endpoints = [];

      expect(issuesOf(manifest)).toEqual([
        "A connection with a credential or endpoints needs a base address.",
      ]);
    });

    it("refuses on-premises connections unless the manifest allows them", () => {
      expect(parsed(jiraManifest()).network?.baseAddress).toEqual({
        field: "baseUrl",
        allowOnPremises: false,
      });
    });

    it("is not combined with a secret address", () => {
      const manifest = icsManifest();
      manifest.connectionFields.push({
        id: "server",
        label: "Server",
        type: "url",
        required: true,
        secret: false,
      });
      (manifest.network as Record<string, unknown>).baseAddress = {
        field: "server",
      };

      expect(issuesOf(manifest)).toEqual([
        "A secret address is the connection's whole address: it has no base address, endpoints or derived hosts.",
      ]);
    });
  });

  describe("endpoints", () => {
    it.each([
      "https://evil.example/_apis",
      "//evil.example/_apis",
      "_apis/connectionData",
      "/_apis/../secrets",
      "/_apis/./x",
      "/_apis//x",
      "/_apis?x=1",
      "/_apis#x",
      "/**/x",
      "/a*b",
      "/_apis\\x",
      "/_apis/a;b",
      "/_apis/..;",
      "/_apis/%00",
    ])("refuses %s", (path) => {
      const manifest = jiraManifest();
      manifest.network.endpoints = [{ method: "GET", path }];

      expect(issuesOf(manifest)).not.toEqual([]);
    });

    it("names the problem with an absolute endpoint", () => {
      const manifest = jiraManifest();
      manifest.network.endpoints = [
        { method: "GET", path: "https://evil.example/x" },
      ];

      expect(issuesOf(manifest)).toEqual([
        "An endpoint is a path relative to its host, starting with /, such as /rest/api/3/issue/*.",
      ]);
    });

    it("refuses a method Ajour doesn't send", () => {
      const manifest = jiraManifest();
      (manifest.network.endpoints as unknown[]) = [
        { method: "CONNECT", path: "/x" },
      ];

      expect(issuesOf(manifest)).not.toEqual([]);
    });

    it("refuses an access choice the manifest doesn't declare", () => {
      const manifest = azureDevOpsManifest();
      manifest.network.endpoints.push({
        method: "DELETE",
        path: "/_apis/wit/workitems/*",
        access: "deleteEverything",
      });

      expect(issuesOf(manifest)).toEqual([
        'The endpoint names the access choice "deleteEverything", which the manifest doesn\'t declare.',
      ]);
    });
  });

  describe("endpoint patterns", () => {
    it.each([
      ["/rest/api/3/issue/*", "/rest/api/3/issue/ABC-1", true],
      ["/rest/api/3/issue/*", "/rest/api/3/issue/ABC-1/comment", false],
      ["/rest/api/3/issue/*", "/rest/api/3/issue", false],
      ["/repos/**", "/repos/acme/app/pulls/1", true],
      ["/repos/**", "/repos", true],
      ["/repos/*/*/activity", "/repos/acme/app/activity", true],
      ["/graphql", "/graphql", true],
      ["/graphql", "/graphql/", false],
      ["/graphql", "/GraphQL", false],
      ["/repos/**", "/repos/../admin", false],
      ["/repos/**", "/repos/%2e%2e/admin", false],
      ["/repos/*", "/repos/a%2Fb", false],
      ["/repos/*", "/repos/v1.2", true],
      ["/repos/*", "/repos/a%20b", true],
      ["/repos/*", "/repos/..;", false],
      ["/repos/**", "/repos/..;/admin", false],
      ["/repos/*", "/repos/.;x", false],
      ["/repos/*", "/repos/..;foo", false],
      ["/repos/*", "/repos/a;b", false],
      ["/repos/*", "/repos/a%3Bb", false],
      ["/repos/*", "/repos/..%00", false],
      ["/repos/*", "/repos/a%00b", false],
      ["/repos/*", "/repos/a%0Ab", false],
      ["/repos/*", "/repos/a%1fb", false],
      ["/repos/*", "/repos/a%7Fb", false],
      ["/repos/*", "/repos/a\u0001b", false],
      ["/repos/**", "/repos/%2E./admin", false],
      ["/repos/**", "/repos/%2e%2e/admin", false],
      ["/repos/**", "/repos/%252e%252e/admin", false],
      ["/repos/**", "/repos/.../admin", false],
      ["/repos/**", "/repos/..%20/admin", false],
      ["/repos/*", "/repos/a%2fb", false],
      ["/repos/*", "/repos/a%5cb", false],
      ["/repos/*", "/repos/a%5Cb", false],
      ["/repos/*", "/repos/a%255cb", false],
      ["/repos/*", "/repos/a\\b", false],
      ["/repos/*", "/repos/%2525", false],
      ["/repos/*", "/repos/100%25", false],
      ["/repos/*", "/repos/%25252e", false],
      ["/repos/*", "/repos/%25zz", false],
      ["/repos/**", "/repos/．．/admin", false],
      ["/repos/**", "/repos/%EF%BC%8E%EF%BC%8E/admin", false],
      ["/repos/**", "/repos/%E2%80%A4%E2%80%A4/admin", false],
      ["/repos/**", "/repos/%E2%80%A4/admin", false],
      ["/repos/*", "/repos/%EF%BC%8F", false],
      ["/repos/*", "/repos/%EF%BC%9B", false],
      ["/repos/*", "/repos/caf%C3%A9", true],
    ])("%s matches %s: %s", (pattern, path, matches) => {
      expect(endpointPatternMatches(pattern, path)).toBe(matches);
    });
  });

  describe("derived hosts", () => {
    const azure = parsed(azureDevOpsManifest());
    const gitHub = parsed(gitHubManifest());
    const host = (manifest: PluginApi4Manifest, id: string) =>
      manifest.network!.derivedHosts.find((candidate) => candidate.id === id)!;

    it.each([
      [
        "Azure DevOps Services",
        "https://dev.azure.com/acme",
        "https://vssps.dev.azure.com/acme",
      ],
      [
        "a visualstudio.com organisation",
        "https://acme.visualstudio.com",
        "https://acme.vssps.visualstudio.com",
      ],
    ])("builds people search for %s", (_name, base, expected) => {
      expect(deriveHostAddress(host(azure, "vssps"), base)).toBe(expected);
    });

    it("has no people search host for an on-premises server", () => {
      expect(
        deriveHostAddress(
          host(azure, "vssps"),
          "https://tfs.acme.local/tfs/DefaultCollection",
        ),
      ).toBeUndefined();
    });

    it.each([
      ["rest", "https://github.com", "https://api.github.com"],
      ["graphql", "https://github.com", "https://api.github.com"],
      ["rest", "https://ghe.acme.com", "https://ghe.acme.com/api/v3"],
      ["graphql", "https://ghe.acme.com", "https://ghe.acme.com/api"],
      ["rest", "https://ghe.acme.com:8443", "https://ghe.acme.com:8443/api/v3"],
    ])("builds GitHub's %s host from %s", (id, base, expected) => {
      expect(deriveHostAddress(host(gitHub, id), base)).toBe(expected);
    });

    it.each([
      [{ host: "evil.example" }, "a fixed host for any base address"],
      [{ whenHost: "github.com", host: "api.evil.example" }, "another domain"],
      [{ whenHost: "*.com", host: "{match}.com" }, "a whole top-level domain"],
      [{ host: "{match}.{host}" }, "{match} without a wildcard"],
      [{ host: "{host}.evil.example" }, "a suffix after {host}"],
      [{ host: "{host}", pathPrefix: "/api/*" }, "a wildcard in the prefix"],
      [
        { whenHost: "*.github.io", host: "{match}.github.io" },
        "a public suffix anyone can register under",
      ],
      [
        { whenHost: "github.io", host: "attacker.github.io" },
        "a fixed host under a public suffix",
      ],
      [{ whenHost: "*.co.uk", host: "{match}.co.uk" }, "a country suffix"],
      [
        { whenHost: "*.workers.dev", host: "{match}.evil.workers.dev" },
        "a hosting suffix",
      ],
      [
        { whenHost: "*.s3.amazonaws.com", host: "{match}.s3.amazonaws.com" },
        "a private suffix",
      ],
      [
        { whenHost: "amazonaws.com", host: "attacker.s3.amazonaws.com" },
        "a host past a private suffix within the domain",
      ],
      [
        { whenHost: "*.visualstudio.com", host: "vssps.visualstudio.com" },
        "a *. rule whose host leaves out {match}",
      ],
      [
        {
          whenHost: "*.visualstudio.com",
          host: "{match}.{match}.visualstudio.com",
        },
        "{match} twice",
      ],
      [{ whenHost: "127.0x1", host: "{host}" }, "an IP address as a rule"],
      [{ whenHost: "0.0.0.1", host: "{host}" }, "a dotted IP address"],
    ])("refuses %j, %s", (form, _reason) => {
      const manifest = gitHubManifest();
      manifest.network.derivedHosts[0]!.forms = [
        form as (typeof manifest.network.derivedHosts)[number]["forms"][number],
      ];

      expect(issuesOf(manifest)).not.toEqual([]);
    });

    it.each([
      [{ whenHost: "acme.local", host: "api.acme.local" }],
      [{ whenHost: "acme.localhost", host: "api.acme.localhost" }],
      [{ whenHost: "acme.internal", host: "api.acme.internal" }],
      [{ whenHost: "acme.test", host: "api.acme.test" }],
      [{ whenHost: "acme.invalid", host: "api.acme.invalid" }],
      [{ whenHost: "acme.example", host: "api.acme.example" }],
      [{ whenHost: "acme.home.arpa", host: "api.acme.home.arpa" }],
      [{ whenHost: "acme.lan", host: "api.acme.lan" }],
      [{ whenHost: "*.acme.local", host: "{match}.api.acme.local" }],
    ])("refuses %j, a reserved or local name", (form) => {
      const manifest = gitHubManifest();
      manifest.network.derivedHosts[0]!.forms = [
        form as (typeof manifest.network.derivedHosts)[number]["forms"][number],
      ];

      expect(issuesOf(manifest)).not.toEqual([]);
    });

    it.each([
      [{ whenHost: "github.com", host: "api.github.com" }],
      [{ whenHost: "dev.azure.com", host: "vssps.{host}" }],
      [{ whenHost: "dev.azure.com", host: "vssps.dev.azure.com" }],
      [
        {
          whenHost: "*.visualstudio.com",
          host: "{match}.vssps.visualstudio.com",
        },
      ],
      [{ host: "{host}", pathPrefix: "/api/v3" }],
    ])("accepts %j", (form) => {
      const manifest = gitHubManifest();
      manifest.network.derivedHosts[0]!.forms = [
        form as (typeof manifest.network.derivedHosts)[number]["forms"][number],
      ];

      expect(issuesOf(manifest)).toEqual([]);
    });

    it.each([
      ["https://acme.amazonaws.com", "https://x.acme.amazonaws.com"],
      ["https://s3.amazonaws.com", undefined],
    ])(
      "derives from %s only within the base host's own domain",
      (base, expected) => {
        const derived = parsed(gitHubManifest()).network!.derivedHosts[0]!;
        derived.forms = [
          {
            whenHost: "*.amazonaws.com",
            host: "x.{match}.amazonaws.com",
            keepBasePath: true,
          },
        ];

        expect(deriveHostAddress(derived, base)).toBe(expected);
      },
    );

    it.each(["/api/..;", "/api/;x", "/api/%2e%2e"])(
      "refuses the path prefix %s",
      (pathPrefix) => {
        const manifest = gitHubManifest();
        manifest.network.derivedHosts[0]!.forms = [
          { host: "{host}", pathPrefix },
        ];

        expect(issuesOf(manifest)).not.toEqual([]);
      },
    );

    it("refuses a whenHost that is a public suffix, and says why", () => {
      const manifest = gitHubManifest();
      manifest.network.derivedHosts[0]!.forms = [
        { whenHost: "*.github.io", host: "{match}.github.io" },
      ];

      expect(issuesOf(manifest)).toEqual([
        "whenHost may not be a public suffix such as github.io or co.uk, where anyone can register a name.",
      ]);
    });

    it("refuses a catch-all form before the last one", () => {
      const manifest = gitHubManifest();
      manifest.network.derivedHosts[0]!.forms.reverse();

      expect(issuesOf(manifest)).toEqual([
        "Only the last form of a derived host may leave out whenHost.",
      ]);
    });

    it("refuses two derived hosts with one id", () => {
      const manifest = gitHubManifest();
      manifest.network.derivedHosts[1]!.id = "rest";

      expect(issuesOf(manifest)).toEqual([
        'Two derived hosts use the id "rest".',
      ]);
    });
  });

  describe("request headers", () => {
    it.each([
      "Authorization",
      "cookie",
      "Host",
      "Proxy-Authorization",
      "Forwarded",
      "X-Forwarded-For",
      "X-HTTP-Method-Override",
      "x-http-method",
      "X-Method-Override",
      "X-Original-URL",
      "X-Rewrite-URL",
      "X-Original-Host",
      "X-Host",
      "X-Real-IP",
      "X-Forwarded-Host",
      "X-Forwarded-Proto",
      "Content-Length",
      "Transfer-Encoding",
      "Connection",
      "TE",
      "Upgrade",
      "Keep-Alive",
      "Trailer",
      "Expect",
    ])("refuses %s, which the denylist holds", (header) => {
      const manifest = jiraManifest();
      manifest.network.requestHeaders = ["Accept", header];

      expect(issuesOf(manifest)).toEqual([
        `A plugin may not set the ${header} header.`,
      ]);
    });

    it("refuses the header a header-template scheme sets", () => {
      const manifest = jiraManifest();
      (manifest.network as Record<string, unknown>).auth = {
        scheme: "headerTemplate",
        header: "X-Api-Key",
        template: "{secret}",
        secretField: "apiToken",
      };
      manifest.network.requestHeaders = ["x-api-key"];

      expect(issuesOf(manifest)).toEqual([
        "A plugin may not set the x-api-key header.",
      ]);
    });

    it("lets the denylist win at request time too", () => {
      const auth = {
        scheme: "headerTemplate",
        header: "X-Api-Key",
        template: "Key {secret}",
        secretField: "apiToken",
      } as const;

      expect(isDeniedRequestHeader("X-API-KEY", auth)).toBe(true);
      expect(isDeniedRequestHeader("proxy-connection", auth)).toBe(true);
      expect(isDeniedRequestHeader("Authorization", undefined)).toBe(true);
      expect(isDeniedRequestHeader("X-Http-Method-Override", auth)).toBe(true);
      expect(isDeniedRequestHeader("Accept", auth)).toBe(false);
    });

    it("needs {secret} exactly once in a header template", () => {
      const manifest = jiraManifest();
      (manifest.network as Record<string, unknown>).auth = {
        scheme: "headerTemplate",
        header: "X-Api-Key",
        template: "Key",
        secretField: "apiToken",
      };

      expect(issuesOf(manifest)).toEqual([
        "A header template holds {secret} exactly once.",
      ]);
    });
  });

  describe("public hosts", () => {
    it.each([
      "https://avatars.githubusercontent.com",
      "avatars.githubusercontent.com/path",
      "*.githubusercontent.com",
      "127.0.0.1",
      "127.0x1",
      "0177.0.0.1",
      "2130706433",
      "0x7f.0.0.1",
      "[::1]",
      "::1",
      "localhost",
      "local",
      "printer.local",
      "app.localhost",
      "db.internal",
      "api.test",
      "api.invalid",
      "api.example",
      "router.home.arpa",
      "nas.lan",
    ])("refuses %s", (publicHost) => {
      const manifest = gitHubManifest();
      manifest.network.publicHosts = [publicHost];

      expect(issuesOf(manifest)).not.toEqual([]);
    });
  });

  describe("agent tasks", () => {
    it("declare the MCP tools a run may use", () => {
      expect(
        parsed(workdayAgentManifest()).capabilities.agentTask?.tasks[0]?.tools,
      ).toEqual(["get_week_changes", "get_week_status"]);
    });

    it("must declare their tools", () => {
      const manifest = workdayAgentManifest();
      delete (manifest.capabilities.agentTask.tasks[0] as { tools?: unknown })
        .tools;

      expect(issuesOf(manifest)).not.toEqual([]);
    });

    it("refuses a tool Ajour doesn't have", () => {
      const manifest = workdayAgentManifest();
      manifest.capabilities.agentTask.tasks[0]!.tools = ["delete_everything"];

      expect(issuesOf(manifest)).not.toEqual([]);
    });
  });

  describe("project data shapes", () => {
    it("run code, so they need an entrypoint", () => {
      const manifest = workdayShapeManifest();
      delete (manifest as { entrypoint?: string }).entrypoint;

      expect(issuesOf(manifest)).toEqual([
        "A plugin that runs code needs an entrypoint.",
      ]);
    });

    it("keep the dataset contract of data shape API 1", () => {
      const manifest = workdayShapeManifest();
      manifest.capabilities.projectDataShape.datasets[0]!.columns.push({
        key: "name",
        header: "Again",
        type: "string",
      });

      expect(issuesOf(manifest)).toEqual([
        'Column key "name" is duplicated in dataset "projects".',
      ]);
    });
  });

  describe("connection access", () => {
    it("refuses two choices with one id", () => {
      const manifest = azureDevOpsManifest();
      manifest.connectionAccess[1]!.id = "readBacklog";

      expect(issuesOf(manifest)).toContain(
        'Two access choices use the id "readBacklog".',
      );
    });
  });
});

describe("the plugins overview", () => {
  it("reports an API 4 plugin that only declares a project data shape", () => {
    const plugin = parsed(workdayShapeManifest());

    expect(
      pluginsOverviewSchema.parse({
        pluginsEnabled: true,
        plugins: [plugin],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      }).plugins[0]?.capabilities.projectDataShape?.datasets?.[0]?.id,
    ).toBe("projects");
  });
});
