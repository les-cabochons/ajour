import { z } from "zod";
import {
  agentTaskObjectSchema,
  checkAgentTaskWeekLink,
  pluginCapabilitiesObjectSchema,
  pluginFieldSchema,
  pluginFieldValuesSchema,
  pluginManifestObjectSchema,
} from "./plugins.ts";
import { projectDataShapeDefinitionSchema } from "./project-data-shapes.ts";
import { readToolInputSchemas, writeToolInputSchemas } from "./agent-tools.ts";
import { getDomain, parse as parseHost } from "tldts";
import {
  connectionAccessOn,
  DENIED_REQUEST_HEADER_PREFIXES,
  DENIED_REQUEST_HEADERS,
  endpointPatternMatches,
  isDeniedHeaderName,
  isEndpointPattern,
} from "./plugin-request-rules.ts";

export {
  connectionAccessOn,
  DENIED_REQUEST_HEADER_PREFIXES,
  DENIED_REQUEST_HEADERS,
  endpointPatternMatches,
};

/*
 * Plugin API 4: the manifest of a plugin that runs in its own sandboxed
 * renderer and reaches the network only through Ajour's broker, which holds
 * every credential. Decided in #219 and the spec #381, after ADR 0007 and
 * ADR 0010.
 *
 * The manifest declares everything the broker enforces and the Access section
 * shows: the auth scheme, the base address, derived hosts, an endpoint
 * allowlist per host, request headers, public hosts, how the plugin starts,
 * and each agent task's MCP tools. Secret fields are host-owned: Ajour never
 * passes one to a plugin and never accepts one back.
 */

export const PLUGIN_API_4 = 4;

/** The memory ceiling a user may set for a plugin's renderer, in MB (#217). */
export const PLUGIN_MEMORY_CEILING_MB = {
  min: 64,
  max: 2048,
  default: 256,
} as const;

/**
 * A strict object, so a misspelt key fails instead of being dropped, with a
 * plain message for each key a later API reserves.
 */
function strictObject<Shape extends z.ZodRawShape>(
  shape: Shape,
  reserved: Record<string, string> = {},
) {
  return z
    .object(shape, {
      errorMap: (issue, context) => {
        if (issue.code === z.ZodIssueCode.unrecognized_keys) {
          const key = issue.keys.find((candidate) => candidate in reserved);
          if (key) return { message: reserved[key]! };
        }
        return { message: context.defaultError };
      },
    })
    .strict();
}

const fieldIdSchema = z.string().trim().min(1).max(120);

/**
 * A connection field or agent task setting. `passToPlugin` exists only so a
 * manifest that asks for a secret to reach its code fails with a clear
 * message: secret fields never reach a plugin.
 */
export const pluginApi4FieldSchema = strictObject(
  {
    ...pluginFieldSchema.shape,
    passToPlugin: z.boolean().optional(),
  },
  {
    generated:
      "Generated secret fields are reserved, and this version of Ajour doesn't support them.",
  },
).superRefine((field, context) => {
  if (field.secret && field.passToPlugin === true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["passToPlugin"],
      message:
        "Secret fields are host-owned: Ajour never passes one to a plugin.",
    });
  }
});
export type PluginApi4Field = z.infer<typeof pluginApi4FieldSchema>;

export const pluginHttpMethods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;
export const pluginHttpMethodSchema = z.enum(pluginHttpMethods);
export type PluginHttpMethod = z.infer<typeof pluginHttpMethodSchema>;

const accessChoiceIdSchema = z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/);

export const pluginEndpointSchema = strictObject({
  method: pluginHttpMethodSchema,
  path: z
    .string()
    .max(500)
    .refine(
      isEndpointPattern,
      "An endpoint is a path relative to its host, starting with /, such as /rest/api/3/issue/*.",
    ),
  /**
   * The connection access choice that unlocks the endpoint. Without one, the
   * endpoint is open whenever its capability is on.
   */
  access: accessChoiceIdSchema.optional(),
});
export type PluginEndpoint = z.infer<typeof pluginEndpointSchema>;

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The Public Suffix List, with its private section: github.io counts too. */
const PUBLIC_SUFFIXES = { allowPrivateDomains: true } as const;

/**
 * A lowercase DNS name of at least two labels, and never an IP address in
 * any form a URL parser reads as one, such as `127.0x1` or `2130706433`.
 */
function isDomainName(value: string) {
  const labels = value.split(".");
  if (
    value.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => HOST_LABEL.test(label)) ||
    /^\d+$/.test(labels.at(-1)!)
  ) {
    return false;
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${value}`).hostname;
  } catch {
    return false;
  }
  return hostname === value && !parseHost(value).isIp;
}

/**
 * Names reserved for local or private use, or that never resolve on the
 * public internet. A fixed host a plugin names may not end in one.
 * Wildcard DNS such as nip.io is the broker's to refuse, from the addresses a
 * name resolves to.
 */
const RESERVED_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "test",
  "invalid",
  "example",
  "home.arpa",
  "lan",
] as const;

function hasReservedSuffix(host: string) {
  return RESERVED_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/**
 * A host name that a plugin may name as a fixed address: not a reserved one.
 * The broker also asks it of a name it cannot resolve itself.
 */
export function isPublicDomainName(value: string) {
  return isDomainName(value) && !hasReservedSuffix(value);
}

/**
 * The registrable domain of a host, such as `github.com` for
 * `api.github.com` or `acme.github.io` for `x.acme.github.io`. Null for a
 * public suffix itself, where anyone can register a name.
 */
function registrableDomain(host: string) {
  return getDomain(host, PUBLIC_SUFFIXES);
}

function hostRuleDomain(whenHost: string) {
  return whenHost.startsWith("*.") ? whenHost.slice(2) : whenHost;
}

function isHostRule(whenHost: string) {
  return isDomainName(hostRuleDomain(whenHost));
}

/** A rule on a public suffix would match hosts anyone can register. */
function isRegistrableHostRule(whenHost: string) {
  return registrableDomain(hostRuleDomain(whenHost)) !== null;
}

/**
 * Whether a host template stays within the address the user saved: it ends
 * with `{host}`, or it stays within the registrable domain its rule matched,
 * and under a `*.` rule it names the label `*` matched, so it reaches the
 * user's own organisation.
 */
function hostTemplateProblem(template: string, whenHost: string | undefined) {
  // whenHost's own message says what is wrong with it.
  if (whenHost && !(isHostRule(whenHost) && isRegistrableHostRule(whenHost))) {
    return undefined;
  }
  const labels = template.split(".");
  const wildcard = whenHost?.startsWith("*.") ?? false;
  for (const [index, label] of labels.entries()) {
    if (label === "{host}" && index === labels.length - 1) continue;
    if (label === "{match}" && wildcard) continue;
    if (!HOST_LABEL.test(label)) {
      return "A derived host is made of host labels, {match} when whenHost starts with *., and {host} last.";
    }
  }
  const matches = labels.filter((label) => label === "{match}").length;
  if (matches > 1) return "A derived host holds {match} at most once.";
  if (labels.at(-1) === "{host}") return undefined;
  if (wildcard && matches === 0) {
    return "Under a *. rule, a derived host names {match}, so it reaches the user's own host.";
  }
  const anchor = whenHost && hostRuleDomain(whenHost);
  const host = template.replace("{match}", "x");
  if (
    !anchor ||
    (template !== anchor && !template.endsWith(`.${anchor}`)) ||
    !isPublicDomainName(host) ||
    registrableDomain(host) !== registrableDomain(anchor)
  ) {
    return "A derived host stays within the address the user saved: end it with {host}, or stay within the domain whenHost names.";
  }
  return undefined;
}

const PATH_PREFIX = /^(?:\/[A-Za-z0-9\-._~!$&'()+,=:@]+)+$/;

export const pluginDerivedHostFormSchema = strictObject({
  /**
   * The base host this form applies to: a host such as `github.com`, or
   * `*.` and a domain, such as `*.visualstudio.com`, where `*` matches one
   * label. Without it, the form applies to any base host, and must be last.
   */
  whenHost: z
    .string()
    .max(253)
    .refine(
      isHostRule,
      "whenHost is a host such as dev.azure.com, or *. and a domain such as *.visualstudio.com.",
    )
    .refine(
      isRegistrableHostRule,
      "whenHost may not be a public suffix such as github.io or co.uk, where anyone can register a name.",
    )
    .optional(),
  /**
   * The host to send to: `{host}` is the base host and `{match}` the label
   * `*` matched, such as `vssps.{host}` or `{match}.vssps.visualstudio.com`.
   */
  host: z.string().min(1).max(253),
  /** A path the broker puts before every request path, such as `/api/v3`. */
  pathPrefix: z
    .string()
    .max(200)
    .refine(
      (prefix) => PATH_PREFIX.test(prefix) && isEndpointPattern(prefix),
      "A path prefix is a literal path such as /api/v3.",
    )
    .optional(),
  /** Whether the base address's own path, such as `/acme`, comes first. */
  keepBasePath: z.boolean().default(true),
}).superRefine((form, context) => {
  const problem = hostTemplateProblem(form.host, form.whenHost);
  if (problem) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["host"],
      message: problem,
    });
  }
});
export type PluginDerivedHostForm = z.infer<typeof pluginDerivedHostFormSchema>;

export const pluginDerivedHostSchema = strictObject({
  id: z.string().regex(/^[a-z][a-zA-Z0-9-]{0,39}$/),
  /** What the Access section calls the host, such as "People search". */
  label: z.string().trim().min(1).max(80).optional(),
  /** Tried in order; the first whose `whenHost` matches the base host wins. */
  forms: z.array(pluginDerivedHostFormSchema).min(1).max(5),
  endpoints: z.array(pluginEndpointSchema).max(200).default([]),
}).superRefine((host, context) => {
  host.forms.forEach((form, index) => {
    if (!form.whenHost && index !== host.forms.length - 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["forms", index, "whenHost"],
        message: "Only the last form of a derived host may leave out whenHost.",
      });
    }
  });
});
export type PluginDerivedHost = z.infer<typeof pluginDerivedHostSchema>;

/**
 * The address the broker sends a derived host's requests to, for a base
 * address the user saved, or undefined when no form applies to its host. The
 * base address's port stays only when the host does.
 */
export function deriveHostAddress(
  derivedHost: Pick<PluginDerivedHost, "forms">,
  baseAddress: string,
): string | undefined {
  let base: URL;
  try {
    base = new URL(baseAddress);
  } catch {
    return undefined;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return undefined;
  const baseHost = base.hostname.toLowerCase();
  for (const form of derivedHost.forms) {
    let match = "";
    if (form.whenHost?.startsWith("*.")) {
      const suffix = `.${form.whenHost.slice(2)}`;
      match = baseHost.slice(0, -suffix.length);
      if (!baseHost.endsWith(suffix) || !match || match.includes(".")) {
        continue;
      }
    } else if (form.whenHost && form.whenHost !== baseHost) {
      continue;
    }
    const host = form.host
      .replaceAll("{host}", baseHost)
      .replaceAll("{match}", match);
    // A base host on a public suffix, such as s3.amazonaws.com, could
    // otherwise send a {match} host to someone else's name under it.
    if (
      host !== baseHost &&
      (registrableDomain(host) === null ||
        registrableDomain(host) !== registrableDomain(baseHost))
    ) {
      return undefined;
    }
    const port = host === baseHost && base.port ? `:${base.port}` : "";
    const basePath =
      form.keepBasePath === false ? "" : base.pathname.replace(/\/+$/, "");
    return `${base.protocol}//${host}${port}${basePath}${form.pathPrefix ?? ""}`;
  }
  return undefined;
}

const secretFieldRef = fieldIdSchema;

/**
 * How the broker attaches a connection's credential. The body-field scheme
 * and generated secrets, designed in #219 for the team plugin, are reserved.
 */
export const pluginAuthSchema = z.discriminatedUnion(
  "scheme",
  [
    /** `Authorization: Bearer <secret>`. */
    strictObject({ scheme: z.literal("bearer"), secretField: secretFieldRef }),
    /** `Authorization: Basic base64(<user>:<secret>)`, as Jira's email and API token. */
    strictObject({
      scheme: z.literal("basic"),
      userField: fieldIdSchema,
      secretField: secretFieldRef,
    }),
    /** `Authorization: Basic base64(:<secret>)`, as an Azure DevOps personal access token. */
    strictObject({
      scheme: z.literal("patBasic"),
      secretField: secretFieldRef,
    }),
    /** One header built from a template, such as `X-Api-Key: {secret}`. */
    strictObject({
      scheme: z.literal("headerTemplate"),
      header: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/),
      template: z.string().min(1).max(500),
      secretField: secretFieldRef,
    }),
    /**
     * The secret is the connection's whole address, as an ICS feed. The
     * plugin asks for it with an empty path, and never learns the address.
     */
    strictObject({
      scheme: z.literal("secretAddress"),
      secretField: secretFieldRef,
    }),
  ],
  {
    errorMap: (issue, context) => {
      if (
        issue.code === z.ZodIssueCode.invalid_union_discriminator &&
        (context.data as { scheme?: unknown } | undefined)?.scheme ===
          "bodyField"
      ) {
        return {
          message:
            "The body-field auth scheme is reserved, and this version of Ajour doesn't support it.",
        };
      }
      return { message: context.defaultError };
    },
  },
);
export type PluginAuth = z.infer<typeof pluginAuthSchema>;
export type PluginAuthScheme = PluginAuth["scheme"];

/** The headers an auth scheme sets, lowercase. */
export function authSchemeHeaders(auth: PluginAuth | undefined): string[] {
  switch (auth?.scheme) {
    case "bearer":
    case "basic":
    case "patBasic":
      return ["authorization"];
    case "headerTemplate":
      return [auth.header.toLowerCase()];
    default:
      return [];
  }
}

/**
 * Whether a plugin may not set the header: the fixed denylist and any header
 * the auth scheme sets always win over the manifest's list.
 */
export function isDeniedRequestHeader(
  name: string,
  auth: PluginAuth | undefined,
) {
  return isDeniedHeaderName(name, authSchemeHeaders(auth));
}

const headerNameSchema = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/, "Use a header name.");

const publicHostSchema = z
  .string()
  .refine(
    isPublicDomainName,
    "A public host is a public host name such as avatars.githubusercontent.com, without a scheme, path, wildcard, or a local name such as .local or .internal.",
  );

export const pluginNetworkSchema = strictObject({
  /** Absent when the plugin's requests carry no credential. */
  auth: pluginAuthSchema.optional(),
  /**
   * The connection field that holds the address every request is relative
   * to. A request may not climb above its path. `allowOnPremises` lets the
   * user mark a connection as on-premises, so private addresses are allowed.
   */
  baseAddress: strictObject({
    field: fieldIdSchema,
    allowOnPremises: z.boolean().default(false),
  }).optional(),
  /** The endpoints the plugin may call on the base address. */
  endpoints: z.array(pluginEndpointSchema).max(200).default([]),
  derivedHosts: z.array(pluginDerivedHostSchema).max(10).default([]),
  /** Request headers the plugin may set, beyond what the broker sets. */
  requestHeaders: z.array(headerNameSchema).max(30).default([]),
  /** Hosts `ajour.publicFetch` may reach, over https and without credentials. */
  publicHosts: z.array(publicHostSchema).max(20).default([]),
});
export type PluginNetwork = z.infer<typeof pluginNetworkSchema>;

/**
 * The connection fields the broker builds a request from: the base address,
 * which every derived host comes from too, and the auth scheme's fields. Only
 * the user sets them. A plugin's validation answer can't change one, so it
 * can't send the saved credential to an address or as a user of its choosing.
 */
export function pluginNetworkFieldIds(
  network: PluginNetwork | undefined,
): string[] {
  const ids = new Set<string>();
  if (network?.baseAddress) ids.add(network.baseAddress.field);
  if (network?.auth) {
    ids.add(network.auth.secretField);
    if (network.auth.scheme === "basic") ids.add(network.auth.userField);
  }
  return [...ids];
}

/**
 * A choice each connection makes about what it may do, such as Azure
 * DevOps's "Edit work items". Every choice starts off; `always` marks one
 * that can't be turned off and is listed only to name the scope it needs.
 */
export const pluginConnectionAccessChoiceSchema = strictObject({
  id: accessChoiceIdSchema,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  /** The token scope the choice needs, in the source tool's words. */
  tokenScope: z.string().trim().min(1).max(200).optional(),
  always: z.boolean().default(false),
  /** The plugin operations the choice unlocks, such as `writeSettle`. */
  operations: z
    .array(z.string().regex(/^[a-z][A-Za-z0-9]{0,62}$/))
    .max(50)
    .default([]),
});
export type PluginConnectionAccessChoice = z.infer<
  typeof pluginConnectionAccessChoiceSchema
>;

export const pluginStartModeSchema = z.enum(["whenNeeded", "alwaysReady"]);
export type PluginStartMode = z.infer<typeof pluginStartModeSchema>;

export const pluginRuntimeSchema = strictObject({
  /** "Load when needed" or "Always ready". The user may change it. */
  start: pluginStartModeSchema.default("whenNeeded"),
  /** The default memory ceiling. Without it, Ajour's default applies. */
  memoryCeilingMb: z
    .number()
    .int()
    .min(PLUGIN_MEMORY_CEILING_MB.min)
    .max(PLUGIN_MEMORY_CEILING_MB.max)
    .optional(),
});
export type PluginRuntime = z.infer<typeof pluginRuntimeSchema>;

/** The Ajour MCP tools an agent task may declare. */
export const agentTaskMcpToolNames = [
  ...Object.keys(readToolInputSchemas),
  ...Object.keys(writeToolInputSchemas),
] as [string, ...string[]];
const agentTaskMcpToolSchema = z.enum(
  agentTaskMcpToolNames as [
    keyof typeof readToolInputSchemas | keyof typeof writeToolInputSchemas,
    ...(
      keyof typeof readToolInputSchemas | keyof typeof writeToolInputSchemas
    )[],
  ],
);
export type AgentTaskMcpTool = z.infer<typeof agentTaskMcpToolSchema>;

/** An agent task, which now declares the MCP tools its run may use. */
export const pluginApi4AgentTaskSchema = agentTaskObjectSchema
  .extend({
    settings: z.array(pluginApi4FieldSchema).max(20).default([]),
    tools: z.array(agentTaskMcpToolSchema).max(agentTaskMcpToolNames.length),
  })
  .superRefine(checkAgentTaskWeekLink);
export type PluginApi4AgentTask = z.infer<typeof pluginApi4AgentTaskSchema>;

export const pluginApi4CapabilitiesSchema = pluginCapabilitiesObjectSchema
  .extend({
    agentTask: z
      .object({ tasks: z.array(pluginApi4AgentTaskSchema).min(1).max(10) })
      .optional(),
    /**
     * A project data shape, with data shape API 1's dataset contract. It
     * moves into the main manifest and runs in the shared runtime.
     */
    projectDataShape: projectDataShapeDefinitionSchema.optional(),
  })
  .superRefine((capabilities, context) => {
    if (capabilities.team !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["team"],
        message:
          "The team capability stays on plugin API 3 until generated secrets ship.",
      });
    }
    if (Object.values(capabilities).every((value) => value === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A plugin must declare at least one capability: connector, codeHost, calendar, agentTask, projectProperties or projectDataShape.",
      });
    }
  });
export type PluginApi4Capabilities = z.infer<
  typeof pluginApi4CapabilitiesSchema
>;

function issue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
) {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function checkNetwork(
  manifest: {
    connectionFields: readonly PluginApi4Field[];
    network?: PluginNetwork;
    connectionAccess: readonly PluginConnectionAccessChoice[];
  },
  context: z.RefinementCtx,
) {
  const network = manifest.network;
  if (!network) return;
  const fields = new Map(
    manifest.connectionFields.map((field) => [field.id, field] as const),
  );
  const { auth, baseAddress } = network;

  if (auth) {
    if (!fields.get(auth.secretField)?.secret) {
      issue(
        context,
        ["network", "auth", "secretField"],
        `The auth scheme's secret field "${auth.secretField}" must be a secret connection field.`,
      );
    }
    if (auth.scheme === "basic" && !fields.has(auth.userField)) {
      issue(
        context,
        ["network", "auth", "userField"],
        `The auth scheme's user field "${auth.userField}" is not a connection field.`,
      );
    }
    if (auth.scheme === "headerTemplate") {
      if (auth.template.split("{secret}").length !== 2) {
        issue(
          context,
          ["network", "auth", "template"],
          "A header template holds {secret} exactly once.",
        );
      }
      const header = auth.header.toLowerCase();
      if (
        ["host", "forwarded"].includes(header) ||
        DENIED_REQUEST_HEADER_PREFIXES.some((prefix) =>
          header.startsWith(prefix),
        )
      ) {
        issue(
          context,
          ["network", "auth", "header"],
          `A header template may not set the ${auth.header} header.`,
        );
      }
    }
  }

  if (auth?.scheme === "secretAddress") {
    if (
      baseAddress ||
      network.endpoints.length > 0 ||
      network.derivedHosts.length > 0
    ) {
      issue(
        context,
        ["network"],
        "A secret address is the connection's whole address: it has no base address, endpoints or derived hosts.",
      );
    }
  } else if (
    !baseAddress &&
    (auth || network.endpoints.length > 0 || network.derivedHosts.length > 0)
  ) {
    issue(
      context,
      ["network", "baseAddress"],
      "A connection with a credential or endpoints needs a base address.",
    );
  }

  if (baseAddress) {
    const field = fields.get(baseAddress.field);
    if (!field || field.type !== "url" || field.secret) {
      issue(
        context,
        ["network", "baseAddress", "field"],
        `The base address field "${baseAddress.field}" must be a url connection field that is not secret.`,
      );
    }
  }

  const hostIds = new Set<string>();
  network.derivedHosts.forEach((host, index) => {
    if (hostIds.has(host.id)) {
      issue(
        context,
        ["network", "derivedHosts", index, "id"],
        `Two derived hosts use the id "${host.id}".`,
      );
    }
    hostIds.add(host.id);
  });

  network.requestHeaders.forEach((header, index) => {
    if (isDeniedRequestHeader(header, auth)) {
      issue(
        context,
        ["network", "requestHeaders", index],
        `A plugin may not set the ${header} header.`,
      );
    }
  });

  const choices = new Set(manifest.connectionAccess.map((choice) => choice.id));
  const endpoints: [PluginEndpoint, (string | number)[]][] = [
    ...network.endpoints.map(
      (endpoint, index) =>
        [endpoint, ["network", "endpoints", index]] as [
          PluginEndpoint,
          (string | number)[],
        ],
    ),
    ...network.derivedHosts.flatMap((host, hostIndex) =>
      host.endpoints.map(
        (endpoint, index) =>
          [
            endpoint,
            ["network", "derivedHosts", hostIndex, "endpoints", index],
          ] as [PluginEndpoint, (string | number)[]],
      ),
    ),
  ];
  for (const [endpoint, path] of endpoints) {
    if (endpoint.access && !choices.has(endpoint.access)) {
      issue(
        context,
        [...path, "access"],
        `The endpoint names the access choice "${endpoint.access}", which the manifest doesn't declare.`,
      );
    }
  }
}

/** Whether the plugin runs code: everything but agent tasks and project properties. */
function api4RunsCode(capabilities: PluginApi4Capabilities) {
  return (
    capabilities.connector !== undefined ||
    capabilities.codeHost !== undefined ||
    capabilities.calendar !== undefined ||
    capabilities.projectDataShape !== undefined
  );
}

export const pluginApi4ManifestSchema = strictObject(
  {
    /** A JSON schema reference for editors. Ajour ignores it. */
    $schema: z.string().max(500).optional(),
    ...pluginManifestObjectSchema.shape,
    apiVersion: z.literal(PLUGIN_API_4),
    connectionFields: z.array(pluginApi4FieldSchema).max(50).default([]),
    capabilities: pluginApi4CapabilitiesSchema,
    network: pluginNetworkSchema.optional(),
    connectionAccess: z
      .array(pluginConnectionAccessChoiceSchema)
      .max(10)
      .default([]),
    runtime: pluginRuntimeSchema.default({}),
  },
  {
    signIn:
      "Sign-in is reserved, and this version of Ajour doesn't support it.",
  },
).superRefine((manifest, context) => {
  if (api4RunsCode(manifest.capabilities) && !manifest.entrypoint) {
    issue(
      context,
      ["entrypoint"],
      "A plugin that runs code needs an entrypoint.",
    );
  }
  const { connector, codeHost, calendar } = manifest.capabilities;
  if (
    (connector || codeHost || calendar) &&
    manifest.connectionFields.length === 0
  ) {
    issue(
      context,
      ["connectionFields"],
      "A backlog, code host or calendar plugin needs connection fields.",
    );
  }
  const choiceIds = new Set<string>();
  manifest.connectionAccess.forEach((choice, index) => {
    if (choiceIds.has(choice.id)) {
      issue(
        context,
        ["connectionAccess", index, "id"],
        `Two access choices use the id "${choice.id}".`,
      );
    }
    choiceIds.add(choice.id);
  });
  checkNetwork(manifest, context);
});
export type PluginApi4Manifest = z.infer<typeof pluginApi4ManifestSchema>;
export type PluginApi4ManifestInput = z.input<typeof pluginApi4ManifestSchema>;

/** Whether a manifest the host admitted is an API 4 one. */
export function isPluginApi4Manifest(manifest: {
  apiVersion: number;
}): manifest is PluginApi4Manifest {
  return manifest.apiVersion === PLUGIN_API_4;
}

/**
 * The connection an API 4 plugin's operations receive. `config` holds only
 * the fields that are not secret, and `access` the connection's access
 * choices that are on.
 */
export const pluginApi4ConnectionSchema = z.object({
  id: z.string().min(1).max(120),
  pluginId: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  tenantLabel: z.string().min(1).max(120),
  autoSync: z.boolean(),
  autoSyncIntervalMinutes: z.number().int().min(1).max(1440),
  connectedAt: z.number().int().positive(),
  lastSyncAt: z.number().int().positive().optional(),
  config: pluginFieldValuesSchema,
  access: z.array(accessChoiceIdSchema).max(10),
});
export type PluginApi4Connection = z.infer<typeof pluginApi4ConnectionSchema>;
