import { z } from "zod";
import { connectorPluginInstallResponseSchema } from "./connectors";

const httpsUrlSchema = z.string().url().refine(
  (value) => new URL(value).protocol === "https:",
  "Catalog links must use HTTPS.",
);

const catalogSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const pluginCatalogEntrySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  type: z.enum(["connector", "plugin"]),
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
  capabilities: z.array(catalogSlugSchema).min(1).max(12),
  install: z
    .object({
      method: z.literal("github-release"),
      allowPrereleases: z.boolean(),
      assetPattern: z.string().min(3).max(200),
    })
    .optional(),
  images: z
    .object({
      thumbnailDataUrl: z.string().startsWith("data:image/").max(1_400_000).optional(),
      heroDataUrl: z.string().startsWith("data:image/").max(1_400_000).optional(),
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

export const catalogConnectorDownloadResponseSchema = z.object({
  type: z.literal("connector"),
  result: connectorPluginInstallResponseSchema,
});

export type CatalogConnectorDownloadResponse = z.infer<
  typeof catalogConnectorDownloadResponseSchema
>;
