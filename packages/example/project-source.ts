/** A deterministic project source for host and acceptance tests. No network calls. */
export const projectSourceManifest = {
  id: "example-project-source",
  version: "1.0.0",
  apiVersion: 4,
  displayName: "Example projects",
  iconSvg: "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z'/></svg>",
  entrypoint: "project-source.ts",
  capabilities: { projectSource: {} },
  connectionFields: [
    { id: "label", label: "Label", type: "text", required: true },
  ],
} as const;

export function validateConnection(connection: {
  config: Record<string, unknown>;
}) {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}

export function syncProjects(
  _connection: unknown,
  request: { cursor?: string },
) {
  if (request.cursor === "fixture-1") return { unchanged: true as const };
  return {
    cursor: "fixture-1",
    snapshot: {
      source: {
        label: "Example planning",
        url: "https://planning.example.com",
      },
      asOf: "2026-11-04T07:00:00Z",
      me: { hoursAvailable: true },
      projects: [
        {
          remoteId: "project-1",
          name: "Example project",
          code: "EX-1",
          complete: false,
          budget: {
            unit: "hours" as const,
            total: 100,
            consumed: 20,
            remaining: 80,
          },
          tasks: [
            {
              remoteId: "task-1",
              name: "Development",
              closed: false,
              assigned: true,
              estimateHours: 40,
              myHours: 8,
            },
          ],
        },
      ],
    },
  };
}
