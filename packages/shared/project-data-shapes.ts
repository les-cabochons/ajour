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
    "Schema plugin identifiers must use lowercase letters, numbers, dots, underscores, or hyphens.",
  )
  .refine(
    (value) => value !== BUILT_IN_PROJECT_DATA_SHAPE_ID,
    `Schema plugin identifier "${BUILT_IN_PROJECT_DATA_SHAPE_ID}" is reserved for Ajour's built-in shape.`,
  );

export const projectDataShapeCellSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type ProjectDataShapeCell = z.infer<typeof projectDataShapeCellSchema>;

export const projectDataShapeColumnSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  header: z.string().trim().min(1).max(120),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean().default(false),
  width: z.number().int().min(8).max(80).optional(),
});
export type ProjectDataShapeColumn = z.infer<
  typeof projectDataShapeColumnSchema
>;

export const projectDataShapeDatasetDefinitionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  displayName: z.string().trim().min(1).max(120),
  columns: z.array(projectDataShapeColumnSchema).min(1).max(100),
});
export type ProjectDataShapeDatasetDefinition = z.infer<
  typeof projectDataShapeDatasetDefinitionSchema
>;

export const projectDataShapeDefinitionSchema = z
  .object({
    apiVersion: z.literal(PROJECT_DATA_SHAPE_CAPABILITY_API_VERSION),
    /**
     * The export layout: one worksheet per dataset. A schema without datasets
     * only imports, and Ajour offers no export with it.
     */
    datasets: z
      .array(projectDataShapeDatasetDefinitionSchema)
      .min(1)
      .max(10)
      .optional(),
  })
  .superRefine((definition, context) => {
    const datasetIds = new Set<string>();
    for (const [datasetIndex, dataset] of (
      definition.datasets ?? []
    ).entries()) {
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
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
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

/** The most an imported file may hold: sheets, rows per sheet, cells per row. */
export const PROJECT_DATA_SHAPE_IMPORT_LIMITS = {
  sheets: 100,
  rows: 100_000,
  cells: 1_000,
} as const;

/**
 * One worksheet of an imported file, as Ajour read it: every row from the
 * first, each cell from column A to the row's last value. Ajour sends every
 * sheet, so the schema finds its data wherever the other tool put it.
 */
export const projectDataShapeSheetSchema = z.object({
  name: z.string().max(255),
  rows: z
    .array(
      z
        .array(projectDataShapeCellSchema)
        .max(PROJECT_DATA_SHAPE_IMPORT_LIMITS.cells),
    )
    .max(PROJECT_DATA_SHAPE_IMPORT_LIMITS.rows),
});
export type ProjectDataShapeSheet = z.infer<typeof projectDataShapeSheetSchema>;

export const projectDataShapeStatusSchema = z.enum(["active", "archived"]);
export type ProjectDataShapeStatus = z.infer<
  typeof projectDataShapeStatusSchema
>;

const canonicalNameSchema = z
  .string()
  .refine(
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
  /**
   * Absent when the file doesn't name its project, such as a project plan.
   * Ajour then takes the file only from Import tasks… on a project's page.
   */
  name: canonicalNameSchema.optional(),
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
  sheets: z
    .array(projectDataShapeSheetSchema)
    .min(1)
    .max(PROJECT_DATA_SHAPE_IMPORT_LIMITS.sheets),
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

/** Checks the datasets a schema exported against its declared export layout. */
export function validateProjectDataShapeDatasets(
  definition: ProjectDataShapeDefinition,
  datasets: ProjectDataShapeDataset[],
) {
  const parsedDefinition = projectDataShapeDefinitionSchema.parse(definition);
  const parsedDatasets = datasets.map((dataset) =>
    projectDataShapeDatasetSchema.parse(dataset),
  );
  const datasetDefinitions = parsedDefinition.datasets ?? [];
  const definitionsById = new Map(
    datasetDefinitions.map((dataset) => [dataset.id, dataset] as const),
  );
  const seenDatasetIds = new Set<string>();

  for (const dataset of parsedDatasets) {
    const datasetDefinition = definitionsById.get(dataset.id);
    if (!datasetDefinition) {
      throw new Error(
        `Schema plugin returned unknown dataset "${dataset.id}".`,
      );
    }
    if (seenDatasetIds.has(dataset.id)) {
      throw new Error(
        `Schema plugin returned dataset "${dataset.id}" more than once.`,
      );
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
        if (typeof value !== column.type) {
          throw new Error(
            `Dataset "${dataset.id}" row ${rowIndex + 1} field "${column.header}" must be ${column.type}.`,
          );
        }
      }
    }
  }

  for (const datasetDefinition of datasetDefinitions) {
    if (!seenDatasetIds.has(datasetDefinition.id)) {
      throw new Error(
        `Schema plugin did not return required dataset "${datasetDefinition.id}".`,
      );
    }
  }

  return parsedDatasets;
}
