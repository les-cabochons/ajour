import { describe, expect, it } from "vitest";
import {
  projectDataShapeExportRequestSchema,
  projectDataShapeImportResponseSchema,
  projectDataShapePluginManifestSchema,
  validateProjectDataShapeDatasets,
  type ProjectDataShapeDefinition,
} from "../src/project-data-shapes";

const definition: ProjectDataShapeDefinition = {
  apiVersion: 1,
  datasets: [
    {
      id: "projects",
      displayName: "Projects",
      columns: [
        {
          key: "project",
          header: "project",
          type: "string",
          required: true,
          width: 28,
        },
        {
          key: "budgetHours",
          header: "budget_hours",
          type: "number",
          required: false,
        },
      ],
    },
  ],
};
const projectsDatasetDefinition = definition.datasets[0]!;

describe("project data shape plugin contract", () => {
  it("accepts a versioned format-neutral shape manifest", () => {
    expect(
      projectDataShapePluginManifestSchema.parse({
        id: "workday-excel",
        version: "1.0.0",
        apiVersion: 1,
        displayName: "Workday",
        description: "Workday-compatible project records.",
        iconSvg: "<svg viewBox='0 0 16 16'></svg>",
        entrypoint: "dist/plugin.mjs",
        capabilities: { projectDataShape: definition },
      }),
    ).toMatchObject({
      id: "workday-excel",
      capabilities: {
        projectDataShape: {
          datasets: [{ id: "projects" }],
        },
      },
    });
  });

  it("reserves the built-in default shape identifier", () => {
    expect(() =>
      projectDataShapePluginManifestSchema.parse({
        id: "default",
        version: "1.0.0",
        apiVersion: 1,
        displayName: "Default override",
        iconSvg: "<svg></svg>",
        entrypoint: "dist/plugin.mjs",
        capabilities: { projectDataShape: definition },
      }),
    ).toThrow(/reserved for Ajour's built-in shape/u);
  });

  it("validates canonical project data without rewriting or narrowing it", () => {
    const longName = "P".repeat(4_001);
    const exportPayload = {
      projects: [
        {
          name: longName,
          code: "  CODE  ",
          color: "",
          status: "active" as const,
          tasks: [
            {
              name: "  Padded task  ",
              status: "active" as const,
              billable: true,
            },
          ],
        },
      ],
    };

    expect(projectDataShapeExportRequestSchema.parse(exportPayload)).toEqual(
      exportPayload,
    );
    expect(
      projectDataShapeImportResponseSchema.parse({
        projects: exportPayload.projects,
      }),
    ).toEqual({ projects: exportPayload.projects });
  });

  it("rejects canonical names containing only whitespace", () => {
    expect(() =>
      projectDataShapeExportRequestSchema.parse({
        projects: [
          {
            name: "   ",
            color: "",
            status: "active",
            tasks: [],
          },
        ],
      }),
    ).toThrow(/non-whitespace/u);
  });

  it("rejects rows that do not match the declared datasets and columns", () => {
    expect(() =>
      validateProjectDataShapeDatasets(definition, [
        {
          id: "projects",
          rows: [{ project: "Mercury", unknown: "value" }],
        },
      ]),
    ).toThrow('contains unknown field "unknown"');

    expect(() =>
      validateProjectDataShapeDatasets(definition, [
        {
          id: "projects",
          rows: [{ project: "Mercury", budgetHours: "two" }],
        },
      ]),
    ).toThrow('field "budget_hours" must be number');
  });

  it("requires every dataset declared by the shape", () => {
    expect(() => validateProjectDataShapeDatasets(definition, [])).toThrow(
      'did not return required dataset "projects"',
    );
  });

  it("rejects duplicate dataset and column identifiers", () => {
    expect(() =>
      projectDataShapePluginManifestSchema.parse({
        id: "duplicate-shape",
        version: "1.0.0",
        apiVersion: 1,
        displayName: "Duplicate",
        iconSvg: "<svg></svg>",
        entrypoint: "dist/plugin.mjs",
        capabilities: {
          projectDataShape: {
            apiVersion: 1,
            datasets: [
              projectsDatasetDefinition,
              projectsDatasetDefinition,
            ],
          },
        },
      }),
    ).toThrow(/Dataset identifier.*projects.*duplicated/u);

    expect(() =>
      projectDataShapePluginManifestSchema.parse({
        id: "duplicate-column-shape",
        version: "1.0.0",
        apiVersion: 1,
        displayName: "Duplicate column",
        iconSvg: "<svg></svg>",
        entrypoint: "dist/plugin.mjs",
        capabilities: {
          projectDataShape: {
            apiVersion: 1,
            datasets: [
              {
                ...projectsDatasetDefinition,
                columns: [
                  projectsDatasetDefinition.columns[0]!,
                  projectsDatasetDefinition.columns[0]!,
                ],
              },
            ],
          },
        },
      }),
    ).toThrow(/Column key.*project.*duplicated/u);
  });
});
