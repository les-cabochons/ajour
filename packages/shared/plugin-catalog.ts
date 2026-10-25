import { z } from "zod";
import {
  pluginInstallResponseSchema,
  pluginKeyFingerprintSchema,
} from "./plugins";

const httpsUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "Catalog links must use HTTPS.",
  );

const catalogSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** The glossary's plugin capabilities. See ADR 0003. */
export const pluginCatalogCapabilitySchema = z.enum([
  "connector",
  "codeHost",
  "calendar",
  "team",
  "agentTask",
  "schema",
]);
export type PluginCatalogCapability = z.infer<
  typeof pluginCatalogCapabilitySchema
>;

/** The family of git host a plugin source lives on. */
export const pluginSourceHostKindSchema = z.enum(["github", "gitlab", "gitea"]);

/**
 * How far Ajour trusts a plugin source's listing, from its `ajour.json.sig`
 * and the key the person approved. The last four list no plugins.
 */
export const pluginSourceStateSchema = z.enum([
  /** Verified with the approved key, or a built-in official key. */
  "signed",
  /** No signature, and none was expected. Its plugins are unsigned. */
  "unsigned",
  /** Verified with a key the person has not approved. Its plugins are unsigned. */
  "untrusted_key",
  /** Verified with another key than the approved one. */
  "key_changed",
  /** A source that was signed lost its signature. */
  "signature_missing",
  /** The signature does not match the listing. */
  "bad_signature",
  /** The listing could not be read and nothing was cached. */
  "unreachable",
]);
export type PluginSourceState = z.infer<typeof pluginSourceStateSchema>;

/** One source in the plugin settings, with what its last read found. */
export const pluginCatalogSourceSchema = z.object({
  url: httpsUrlSchema,
  /** The listing's name. Absent until Ajour read the source once. */
  name: z.string().min(1).max(80).optional(),
  official: z.boolean(),
  hostKind: pluginSourceHostKindSchema.optional(),
  state: pluginSourceStateSchema,
  /** The key that signed the listing Ajour read. */
  keyFingerprint: pluginKeyFingerprintSchema.optional(),
  /** The key the person approved, when it differs or the source is blocked. */
  approvedKeyFingerprint: pluginKeyFingerprintSchema.optional(),
  pluginCount: z.number().int().nonnegative(),
  /** Why the source is unreachable or blocked, for the person. */
  message: z.string().max(500).optional(),
});
export type PluginCatalogSource = z.infer<typeof pluginCatalogSourceSchema>;

export const pluginCatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  author: z.object({
    name: z.string().min(1).max(100),
    url: httpsUrlSchema,
  }),
  license: z.object({
    name: z.string().min(1).max(80),
    spdxId: z.string().regex(/^[A-Za-z0-9-.+]+$/),
    url: httpsUrlSchema.optional(),
  }),
  website: httpsUrlSchema.optional(),
  /** The source repository, with `slug` as its owner and name. */
  repository: z
    .object({
      slug: z.string().min(3).max(200),
      url: httpsUrlSchema,
    })
    .optional(),
  /**
   * The plugin source that lists it, and whether its listing is signed.
   * Absent for an installed plugin no source lists.
   */
  source: z
    .object({
      url: httpsUrlSchema,
      name: z.string().min(1).max(80),
      official: z.boolean(),
      signed: z.boolean(),
      keyFingerprint: pluginKeyFingerprintSchema.optional(),
    })
    .optional(),
  status: z.enum(["available", "coming-soon", "deprecated"]),
  compatibility: z.object({
    pluginApiVersion: z.number().int().positive(),
  }),
  capabilities: z
    .array(pluginCatalogCapabilitySchema)
    .min(1)
    .max(pluginCatalogCapabilitySchema.options.length)
    .refine(
      (capabilities) => new Set(capabilities).size === capabilities.length,
      "Catalog capabilities must not repeat.",
    ),
  /** What the plugin does, shown as badges, such as "work-item-sync". */
  features: z.array(catalogSlugSchema).min(1).max(12),
  /** Present when Ajour can download the plugin from its source. */
  install: z.object({ method: z.literal("source") }).optional(),
  images: z
    .object({
      thumbnailDataUrl: z
        .string()
        .startsWith("data:image/")
        .max(1_400_000)
        .optional(),
      heroDataUrl: z
        .string()
        .startsWith("data:image/")
        .max(1_400_000)
        .optional(),
    })
    .optional(),
  tags: z.array(catalogSlugSchema).min(1).max(12),
});

export type PluginCatalogEntry = z.infer<typeof pluginCatalogEntrySchema>;

export const pluginCatalogResponseSchema = z.object({
  entries: z.array(pluginCatalogEntrySchema),
  sources: z.array(pluginCatalogSourceSchema).max(50).default([]),
  checkedAt: z.string().datetime(),
  source: z.enum(["network", "cache"]),
  warning: z.string().max(1_000).optional(),
  /** Entries this Ajour version cannot read, such as a newer capability. */
  skippedPluginIds: z.array(z.string().max(100)).max(100).optional(),
});

export type PluginCatalogResponse = z.infer<typeof pluginCatalogResponseSchema>;

export const pluginCatalogRefreshMinutesSchema = z.union([
  z.literal(0),
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal(240),
]);

export const pluginCatalogSettingsSchema = z.object({
  refreshMinutes: pluginCatalogRefreshMinutesSchema,
  /** Whether unsigned plugins may be installed, each time after a warning. */
  allowUnsignedInstalls: z.boolean().default(false),
});

export type PluginCatalogSettings = z.infer<typeof pluginCatalogSettingsSchema>;

export const catalogPluginDownloadResponseSchema = z.object({
  type: z.literal("plugin"),
  result: pluginInstallResponseSchema,
});

/** A download the person cancelled at the unsigned warning answers null. */
export const catalogPluginDownloadOutcomeSchema =
  catalogPluginDownloadResponseSchema.nullable();

export type CatalogPluginDownloadResponse = z.infer<
  typeof catalogPluginDownloadResponseSchema
>;

/** What a source holds, read before the person adds it. */
export const pluginSourceInspectionSchema = z.object({
  url: httpsUrlSchema,
  name: z.string().min(1).max(80),
  official: z.boolean(),
  hostKind: pluginSourceHostKindSchema,
  /** Whether the listing carries a signature that verified. */
  signed: z.boolean(),
  /** The key to approve. Absent for an unsigned source. */
  keyFingerprint: pluginKeyFingerprintSchema.optional(),
  plugins: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(80),
        version: z.string().min(1).max(80),
      }),
    )
    .max(100),
  alreadyAdded: z.boolean(),
});
export type PluginSourceInspection = z.infer<
  typeof pluginSourceInspectionSchema
>;

function parsePluginVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/**
 * Semantic version precedence: negative when `left` is older, positive when
 * newer, 0 when equal or unreadable. A prerelease comes before its release.
 */
export function comparePluginVersions(left: string, right: string) {
  const a = parsePluginVersion(left);
  const b = parsePluginVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = a.core[index]! - b.core[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  for (
    let index = 0;
    index < Math.max(a.prerelease.length, b.prerelease.length);
    index += 1
  ) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric && Number(x) !== Number(y)) {
      return Math.sign(Number(x) - Number(y));
    }
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
