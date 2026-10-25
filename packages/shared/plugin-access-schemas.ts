import { z } from "zod";
import type {
  PluginAccessAuth,
  PluginAccessDerivedHost,
  PluginAccessDifference,
  PluginAccessEndpoint,
  PluginAccessHost,
  PluginAccessManifest,
  PluginAccessMcpTool,
  PluginAccessOperation,
  PluginAccessSummary,
} from "./plugin-access.ts";

/*
 * The access shapes as zod schemas, for the overview that carries them to the
 * Access section and for the consent the state keeps. Nothing here imports
 * plugin API 4's schemas as values: they import `plugins.ts`, which imports
 * this file, so the enums below repeat theirs and the annotations check that
 * they still agree.
 */

const shortText = z.string().max(1000);
const methodSchema = z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const authSchemeSchema = z.enum([
  "bearer",
  "basic",
  "patBasic",
  "headerTemplate",
  "secretAddress",
]);

const authSchema: z.ZodType<PluginAccessAuth> = z.object({
  scheme: authSchemeSchema,
  fields: z.array(shortText).max(4),
});
const hostSchema: z.ZodType<PluginAccessHost> = z.object({
  kind: z.enum(["baseAddress", "secretAddress"]),
  field: shortText,
});
const derivedHostSchema: z.ZodType<PluginAccessDerivedHost> = z.object({
  id: shortText,
  whenHost: shortText.optional(),
  host: shortText,
  pathPrefix: shortText.optional(),
  keepBasePath: z.boolean(),
});
const endpointSchema: z.ZodType<PluginAccessEndpoint> = z.object({
  host: shortText,
  method: methodSchema,
  path: shortText,
  access: shortText.optional(),
});
const mcpToolSchema: z.ZodType<PluginAccessMcpTool> = z.object({
  task: shortText,
  tool: shortText,
});
const operationSchema: z.ZodType<PluginAccessOperation> = z.object({
  choice: shortText,
  operation: shortText,
});

export const pluginAccessSummarySchema: z.ZodType<PluginAccessSummary> =
  z.object({
    capabilities: z.array(shortText).max(20),
    authSchemes: z.array(authSchema).max(5),
    hosts: z.array(hostSchema).max(5),
    derivedHosts: z.array(derivedHostSchema).max(60),
    endpoints: z.array(endpointSchema).max(2000),
    publicHosts: z.array(shortText).max(20),
    mcpTools: z.array(mcpToolSchema).max(500),
    agentPrompts: z
      .array(z.object({ task: shortText, prompt: shortText }))
      .max(10),
    alwaysOnAccess: z.array(shortText).max(10),
    accessOperations: z.array(operationSchema).max(500),
    startMode: z.enum(["whenNeeded", "alwaysReady"]),
  });

export const pluginAccessDifferenceSchema: z.ZodType<PluginAccessDifference> =
  z.object({
    capabilities: z.array(shortText).max(20),
    authSchemes: z.array(authSchema).max(5),
    hosts: z.array(hostSchema).max(5),
    derivedHosts: z.array(derivedHostSchema).max(60),
    endpoints: z.array(endpointSchema).max(2000),
    publicHosts: z.array(shortText).max(20),
    mcpTools: z.array(mcpToolSchema).max(500),
    agentPrompts: z.array(shortText).max(10),
    alwaysOnAccess: z.array(shortText).max(10),
    accessOperations: z.array(operationSchema).max(500),
    ungatedOperations: z.array(shortText).max(500),
    alwaysReady: z.boolean(),
  });

/**
 * What the Access section needs besides the summary, in the manifest's own
 * words: what each derived host is called, and the access choices with the
 * token scope each needs.
 */
export interface PluginAccessView {
  summary: PluginAccessSummary;
  /** A derived host's id to the label its plugin gave it. */
  hostLabels: Record<string, string>;
  choices: {
    id: string;
    label: string;
    tokenScope?: string;
    always: boolean;
  }[];
}

export const pluginAccessViewSchema: z.ZodType<PluginAccessView> = z.object({
  summary: pluginAccessSummarySchema,
  hostLabels: z.record(z.string().max(80)),
  choices: z
    .array(
      z.object({
        id: shortText,
        label: z.string().max(80),
        tokenScope: z.string().max(200).optional(),
        always: z.boolean(),
      }),
    )
    .max(10),
});

/** The summary with the labels the manifest gives its hosts and access choices. */
export function pluginAccessView(
  manifest: PluginAccessManifest,
  summary: PluginAccessSummary,
): PluginAccessView {
  return {
    summary,
    hostLabels: Object.fromEntries(
      (manifest.network?.derivedHosts ?? []).flatMap((host) =>
        host.label ? [[host.id, host.label]] : [],
      ),
    ),
    choices: (manifest.connectionAccess ?? []).map((choice) => ({
      id: choice.id,
      label: choice.label ?? choice.id,
      ...(choice.tokenScope ? { tokenScope: choice.tokenScope } : {}),
      always: choice.always,
    })),
  };
}

/** What the user allowed by turning the plugin on: the version, and what it reached. */
export interface PluginConsent {
  version: string;
  access: PluginAccessSummary;
  at: number;
}

export const pluginConsentSchema: z.ZodType<PluginConsent> = z.object({
  version: shortText,
  access: pluginAccessSummarySchema,
  at: z.number().nonnegative(),
});

/**
 * An update that needs the user's consent, which the plugin page shows as
 * "Version N needs more access": the version installed, and only what it adds
 * to what was allowed.
 */
export interface PluginPendingAccess {
  version: string;
  difference: PluginAccessDifference;
}

export const pluginPendingAccessSchema: z.ZodType<PluginPendingAccess> =
  z.object({
    version: shortText,
    difference: pluginAccessDifferenceSchema,
  });

/** What the broker recorded for a plugin's requests, for the Access section. */
export interface PluginAccessActivity {
  lastRequestAt?: number;
  blockedCount?: number;
  lastBlockedAt?: number;
}

export const pluginAccessActivitySchema: z.ZodType<PluginAccessActivity> =
  z.object({
    lastRequestAt: z.number().positive().optional(),
    blockedCount: z.number().int().positive().optional(),
    lastBlockedAt: z.number().positive().optional(),
  });
