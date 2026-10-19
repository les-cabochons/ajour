import { z } from "zod";
import { pluginInstallResponseSchema } from "./plugins";

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

export const pluginCatalogEntrySchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  author: z.object({
    name: z.string().min(1).max(100),
    url: httpsUrlSchema,
  }),
  license: z.object({
    name: z.string().min(1).max(80),
    spdxId: z.string().regex(/^[A-Za-z0-9-.+]+$/),
    url: httpsUrlSchema,
  }),
  website: httpsUrlSchema,
  repository: z.object({
    provider: z.literal("github"),
    slug: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    url: httpsUrlSchema,
  }),
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
  install: z
    .object({
      method: z.literal("github-release"),
      allowPrereleases: z.boolean(),
      assetPattern: z.string().min(3).max(200),
    })
    .optional(),
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
});

export type PluginCatalogSettings = z.infer<typeof pluginCatalogSettingsSchema>;

export const catalogPluginDownloadResponseSchema = z.object({
  type: z.literal("plugin"),
  result: pluginInstallResponseSchema,
});

export type CatalogPluginDownloadResponse = z.infer<
  typeof catalogPluginDownloadResponseSchema
>;
