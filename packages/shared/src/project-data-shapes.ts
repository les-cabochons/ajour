import { z } from "zod";

export const PROJECT_DATA_SHAPE_PLUGIN_API_VERSION = 1;
export const PROJECT_DATA_SHAPE_CAPABILITY_API_VERSION = 1;
export const BUILT_IN_PROJECT_DATA_SHAPE_ID = "default";

export const projectDataShapePluginIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    "Project data shape plugin identifiers must use lowercase letters, numbers, dots, underscores, or hyphens.",
  )
  .refine(
    (value) => value !== BUILT_IN_PROJECT_DATA_SHAPE_ID,
    `Project data shape plugin identifier "${BUILT_IN_PROJECT_DATA_SHAPE_ID}" is reserved for Ajour's built-in shape.`,
  );

export const projectDataShapeCellSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type ProjectDataShapeCell = z.infer<typeof projectDataShapeCellSchema>;

export const projectDataShapeColumnSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  header: z.string().trim().min(1).max(120),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean().default(false),
  width: z.number().int().min(8).max(80).optional(),
});
export type ProjectDataShapeColumn = z.infer<
  typeof projectDataShapeColumnSchema
>;

export const projectDataShapeDatasetDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  displayName: z.string().trim().min(1).max(120),
  columns: z.array(projectDataShapeColumnSchema).min(1).max(100),
});
export type ProjectDataShapeDatasetDefinition = z.infer<
  typeof projectDataShapeDatasetDefinitionSchema
>;

export const projectDataShapeDefinitionSchema = z
  .object({
    apiVersion: z.literal(PROJECT_DATA_SHAPE_CAPABILITY_API_VERSION),
    datasets: z.array(projectDataShapeDatasetDefinitionSchema).min(1).max(10),
  })
  .superRefine((definition, context) => {
    const datasetIds = new Set<string>();
    for (const [datasetIndex, dataset] of definition.datasets.entries()) {
      if (datasetIds.has(dataset.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Dataset identifier "${dataset.id}" is duplicated.`,
          path: ["datasets", datasetIndex, "id"],
        });
      }
      datasetIds.add(dataset.id);

      const columnKeys = new Set<string>();
      for (const [columnIndex, column] of dataset.columns.entries()) {
        if (columnKeys.has(column.key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Column key "${column.key}" is duplicated in dataset "${dataset.id}".`,
            path: ["datasets", datasetIndex, "columns", columnIndex, "key"],
          });
        }
        columnKeys.add(column.key);
      }
    }
  });
export type ProjectDataShapeDefinition = z.infer<
  typeof projectDataShapeDefinitionSchema
>;

export const projectDataShapePluginManifestSchema = z.object({
  id: projectDataShapePluginIdSchema,
  version: z.string().trim().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  apiVersion: z.literal(PROJECT_DATA_SHAPE_PLUGIN_API_VERSION),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  iconSvg: z.string().min(1).max(20_000),
  entrypoint: z.string().trim().min(1).max(240),
  capabilities: z.object({
    projectDataShape: projectDataShapeDefinitionSchema,
  }),
});
export type ProjectDataShapePluginManifest = z.infer<
  typeof projectDataShapePluginManifestSchema
>;

export const projectDataShapeRowSchema = z.record(
  z.string().min(1).max(120),
  projectDataShapeCellSchema,
);
export type ProjectDataShapeRow = z.infer<typeof projectDataShapeRowSchema>;

export const projectDataShapeDatasetSchema = z.object({
  id: z.string().trim().min(1).max(120),
  rows: z.array(projectDataShapeRowSchema).max(100_000),
});
export type ProjectDataShapeDataset = z.infer<
  typeof projectDataShapeDatasetSchema
>;

export const projectDataShapeStatusSchema = z.enum(["active", "archived"]);
export type ProjectDataShapeStatus = z.infer<
  typeof projectDataShapeStatusSchema
>;

const canonicalNameSchema = z.string().refine(
  (value) => value.trim().length > 0,
  "Canonical names must contain non-whitespace characters.",
);

export const projectDataShapeExportTaskSchema = z.object({
  name: canonicalNameSchema,
  status: projectDataShapeStatusSchema,
  billable: z.boolean(),
  budgetMs: z.number().int().nonnegative().optional(),
  adjustmentMs: z.number().int().optional(),
});

export const projectDataShapeExportProjectSchema = z.object({
  name: canonicalNameSchema,
  code: z.string().optional(),
  color: z.string(),
  status: projectDataShapeStatusSchema,
  tasks: z.array(projectDataShapeExportTaskSchema).max(10_000),
});
export type ProjectDataShapeExportProject = z.infer<
  typeof projectDataShapeExportProjectSchema
>;

export const projectDataShapeImportTaskSchema = z.object({
  name: canonicalNameSchema,
  status: projectDataShapeStatusSchema.optional(),
  billable: z.boolean().optional(),
  budgetMs: z.number().int().nonnegative().optional(),
  adjustmentMs: z.number().int().optional(),
});

export const projectDataShapeImportProjectSchema = z.object({
  name: canonicalNameSchema,
  code: z.string().optional(),
  color: z.string().optional(),
  status: projectDataShapeStatusSchema,
  tasks: z.array(projectDataShapeImportTaskSchema).max(10_000),
});
export type ProjectDataShapeImportProject = z.infer<
  typeof projectDataShapeImportProjectSchema
>;

export const projectDataShapeListResponseSchema = z.object({
  plugins: z.array(projectDataShapePluginManifestSchema),
});
export type ProjectDataShapeListResponse = z.infer<
  typeof projectDataShapeListResponseSchema
>;

export const projectDataShapeExportRequestSchema = z.object({
  projects: z.array(projectDataShapeExportProjectSchema).max(10_000),
});
export type ProjectDataShapeExportRequest = z.infer<
  typeof projectDataShapeExportRequestSchema
>;

export const projectDataShapeExportResponseSchema = z.object({
  datasets: z.array(projectDataShapeDatasetSchema).min(1).max(10),
});
export type ProjectDataShapeExportResponse = z.infer<
  typeof projectDataShapeExportResponseSchema
>;

export const projectDataShapeImportRequestSchema = z.object({
  datasets: z.array(projectDataShapeDatasetSchema).min(1).max(10),
});
export type ProjectDataShapeImportRequest = z.infer<
  typeof projectDataShapeImportRequestSchema
>;

export const projectDataShapeImportResponseSchema = z.object({
  projects: z.array(projectDataShapeImportProjectSchema).max(100_000),
});
export type ProjectDataShapeImportResponse = z.infer<
  typeof projectDataShapeImportResponseSchema
>;

export function validateProjectDataShapeDatasets(
  definition: ProjectDataShapeDefinition,
  datasets: ProjectDataShapeDataset[],
  options: { validateRequiredValues?: boolean; validateValueTypes?: boolean } = {},
) {
  const parsedDefinition = projectDataShapeDefinitionSchema.parse(definition);
  const parsedDatasets = datasets.map((dataset) =>
    projectDataShapeDatasetSchema.parse(dataset),
  );
  const definitionsById = new Map(
    parsedDefinition.datasets.map((dataset) => [dataset.id, dataset] as const),
  );
  const seenDatasetIds = new Set<string>();

  for (const dataset of parsedDatasets) {
    const datasetDefinition = definitionsById.get(dataset.id);
    if (!datasetDefinition) {
      throw new Error(`Project data shape returned unknown dataset "${dataset.id}".`);
    }
    if (seenDatasetIds.has(dataset.id)) {
      throw new Error(`Project data shape returned dataset "${dataset.id}" more than once.`);
    }
    seenDatasetIds.add(dataset.id);

    const columnsByKey = new Map(
      datasetDefinition.columns.map((column) => [column.key, column] as const),
    );
    for (const [rowIndex, row] of dataset.rows.entries()) {
      for (const key of Object.keys(row)) {
        if (!columnsByKey.has(key)) {
          throw new Error(
            `Dataset "${dataset.id}" row ${rowIndex + 1} contains unknown field "${key}".`,
          );
        }
      }

      for (const column of datasetDefinition.columns) {
        const value = row[column.key];
        if (
          options.validateRequiredValues !== false &&
          column.required &&
          (value === null || value === undefined || value === "")
        ) {
          throw new Error(
            `Dataset "${dataset.id}" row ${rowIndex + 1} requires "${column.header}".`,
          );
        }
        if (value === null || value === undefined || value === "") {
          continue;
        }
        if (
          options.validateValueTypes !== false &&
          typeof value !== column.type
        ) {
          throw new Error(
            `Dataset "${dataset.id}" row ${rowIndex + 1} field "${column.header}" must be ${column.type}.`,
          );
        }
      }
    }
  }

  for (const datasetDefinition of parsedDefinition.datasets) {
    if (!seenDatasetIds.has(datasetDefinition.id)) {
      throw new Error(
        `Project data shape did not return required dataset "${datasetDefinition.id}".`,
      );
    }
  }

  return parsedDatasets;
}
