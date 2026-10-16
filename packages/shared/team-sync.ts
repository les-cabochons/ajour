import { z } from "zod";

/*
 * The team capability: a plugin keeps the shared projects of a team in step
 * between the workspaces of its members. Each sync sends the team-owned fields
 * that changed since the last sync, then receives the team's changes since a
 * cursor, so the later write to a field wins. See ADR 0006 and
 * docs/superpowers/specs/2026-10-16-team-project-sync-design.md.
 *
 * Only team-owned fields cross this boundary. Time entries, tracked totals,
 * notes, budget consumption, pinned slots, plugin properties, order and the
 * budget adjustment never do.
 */

export const TEAM_CAPABILITY_API_VERSION = 1;

/** Projects in one sync request or one page of a result. */
export const TEAM_SYNC_MAX_PROJECTS = 25;
/**
 * Tasks in one sync request or one page of a result, across all its projects.
 * With the field bounds below, a worst-case page stays under half the
 * worker's 8 MiB result limit. A project with more tasks spans several pages.
 */
export const TEAM_SYNC_MAX_TASKS = 2_000;

export const teamCapabilitySchema = z.object({
  apiVersion: z.literal(TEAM_CAPABILITY_API_VERSION),
});
export type TeamCapability = z.infer<typeof teamCapabilitySchema>;

/** A local project or task ID. It never changes, so time entries keep it. */
const localIdSchema = z.string().trim().min(1).max(200);
/** The ID the team gave a shared project or task. */
const remoteIdSchema = z.string().trim().min(1).max(100);
const cursorSchema = z.string().min(1).max(2_000);
const statusSchema = z.enum(["active", "archived"]);
/** What Ajour's color field produces. */
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
/**
 * Uploaded icons are 32 pixel PNG images, a few KB each. Ajour renders them
 * inside a CSS `url("...")`, so only a complete base64 PNG data URL passes:
 * no quote, parenthesis or second URL can follow it.
 */
const iconImageSchema = z
  .string()
  .max(16_384)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);

export const teamProjectIconSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("preset"),
    /** Ajour falls back to its default icon for a name it does not know. */
    name: z.string().trim().min(1).max(60),
  }),
  z.object({
    kind: z.literal("upload"),
    src: iconImageSchema,
    maskSrc: iconImageSchema.optional(),
    colorMode: z.enum(["tinted", "native"]).optional(),
  }),
]);
export type TeamProjectIcon = z.infer<typeof teamProjectIconSchema>;

/** The team-owned fields of a task. Null clears a value. */
const teamTaskFields = {
  name: z.string().trim().min(1).max(240),
  status: statusSchema,
  billable: z.boolean(),
  budgetMs: z.number().int().positive().nullable(),
};
export const teamTaskFieldsSchema = z.object(teamTaskFields);
export type TeamTaskFields = z.infer<typeof teamTaskFieldsSchema>;

/** The team-owned fields of a project. Null clears a value. */
const teamProjectFields = {
  name: z.string().trim().min(1).max(240),
  displayName: z.string().trim().min(1).max(240),
  code: z.string().trim().min(1).max(120).nullable(),
  color: colorSchema,
  icon: teamProjectIconSchema,
  status: statusSchema,
};
export const teamProjectFieldsSchema = z.object(teamProjectFields);
export type TeamProjectFields = z.infer<typeof teamProjectFieldsSchema>;

/** Every field a new record must carry, since the team has nothing to merge. */
function requireAllFieldsWhenNew(fieldNames: readonly string[]) {
  return (
    change: { remoteId?: string } & Record<string, unknown>,
    context: z.RefinementCtx,
  ) => {
    if (change.remoteId !== undefined) return;
    for (const field of fieldNames) {
      if (change[field] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `A new shared record needs ${field}.`,
        });
      }
    }
  };
}

/** Keeps a request or a page within `TEAM_SYNC_MAX_TASKS` in total. */
function limitTotalTasks(
  projects: readonly { tasks: readonly unknown[] }[],
  context: z.RefinementCtx,
) {
  const total = projects.reduce(
    (count, project) => count + project.tasks.length,
    0,
  );
  if (total > TEAM_SYNC_MAX_TASKS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `A team sync page holds at most ${TEAM_SYNC_MAX_TASKS} tasks, not ${total}.`,
    });
  }
}

/**
 * A task change to push. Without `remoteId` the task is new and carries every
 * field. With it, only the fields changed since the last sync, so a field a
 * teammate changed meanwhile keeps their value.
 *
 * The team treats the `localId` of a new record as an idempotency key: a new
 * record whose local ID it has assigned before gets the same remote ID again
 * and creates nothing. A round that failed after the team applied it, such as
 * on a timeout, is then safe to send again.
 */
export const teamTaskChangeSchema = z
  .object({
    localId: localIdSchema,
    remoteId: remoteIdSchema.optional(),
    name: teamTaskFields.name.optional(),
    status: teamTaskFields.status.optional(),
    billable: teamTaskFields.billable.optional(),
    budgetMs: teamTaskFields.budgetMs.optional(),
  })
  .superRefine(requireAllFieldsWhenNew(Object.keys(teamTaskFields)));
export type TeamTaskChange = z.infer<typeof teamTaskChangeSchema>;

/**
 * A project change to push, with the same rules as a task. A change to an
 * existing project may carry only task changes, and a project with many
 * changed tasks spans several rounds.
 */
export const teamProjectChangeSchema = z
  .object({
    localId: localIdSchema,
    remoteId: remoteIdSchema.optional(),
    name: teamProjectFields.name.optional(),
    displayName: teamProjectFields.displayName.optional(),
    code: teamProjectFields.code.optional(),
    color: teamProjectFields.color.optional(),
    icon: teamProjectFields.icon.optional(),
    status: teamProjectFields.status.optional(),
    tasks: z.array(teamTaskChangeSchema).max(TEAM_SYNC_MAX_TASKS).default([]),
  })
  .superRefine(requireAllFieldsWhenNew(Object.keys(teamProjectFields)));
export type TeamProjectChange = z.infer<typeof teamProjectChangeSchema>;

export const teamTaskSchema = z.object({
  remoteId: remoteIdSchema,
  ...teamTaskFields,
});
export type TeamTask = z.infer<typeof teamTaskSchema>;

/** Reports each value that appears twice, at its path. */
function refuseRepeats(
  values: readonly { value: string; path: (string | number)[] }[],
  what: string,
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  for (const { value, path } of values) {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `${what} ${value} appears twice.`,
      });
    }
    seen.add(value);
  }
}

const teamProjectShape = {
  remoteId: remoteIdSchema,
  ...teamProjectFields,
};

function refuseRepeatedTasks(
  project: { tasks: readonly { remoteId: string }[] },
  context: z.RefinementCtx,
) {
  refuseRepeats(
    project.tasks.map((task, index) => ({
      value: task.remoteId,
      path: ["tasks", index, "remoteId"],
    })),
    "Task",
    context,
  );
}

/**
 * A team project as the team has it now, with its tasks changed since the
 * cursor, or all of them without one. Tasks are never deleted, so a task that
 * is absent is unchanged, and a project with many changed tasks can span pages.
 */
export const teamProjectSchema = z
  .object({
    ...teamProjectShape,
    tasks: z.array(teamTaskSchema).max(TEAM_SYNC_MAX_TASKS),
  })
  .superRefine(refuseRepeatedTasks);
export type TeamProject = z.infer<typeof teamProjectSchema>;

/**
 * A team project Ajour keeps locally, such as one held for the user, after
 * several pages added to it. It has no page bound on its tasks.
 */
export const teamStoredProjectSchema = z
  .object({ ...teamProjectShape, tasks: z.array(teamTaskSchema) })
  .superRefine(refuseRepeatedTasks);

/**
 * One sync round. Without a cursor the result starts from the whole team,
 * which is what the picker shows before anything is shared.
 */
export const teamSyncRequestSchema = z.object({
  cursor: cursorSchema.optional(),
  changes: z
    .array(teamProjectChangeSchema)
    .max(TEAM_SYNC_MAX_PROJECTS)
    .superRefine(limitTotalTasks)
    .superRefine((changes, context) =>
      refuseRepeats(
        changes.flatMap((change, index) => [
          { value: change.localId, path: [index, "localId"] },
          ...change.tasks.map((task, taskIndex) => ({
            value: task.localId,
            path: [index, "tasks", taskIndex, "localId"],
          })),
        ]),
        "Local ID",
        context,
      ),
    )
    .default([]),
});
export type TeamSyncRequest = z.infer<typeof teamSyncRequestSchema>;

export const teamRemoteIdAssignmentSchema = z.object({
  localId: localIdSchema,
  remoteId: remoteIdSchema,
});
export type TeamRemoteIdAssignment = z.infer<
  typeof teamRemoteIdAssignmentSchema
>;

/**
 * The team applies `changes` before it reads `projects`, so the last writer
 * wins inside one round. `assigned` gives the remote ID of each new project
 * and task. With `hasMore`, Ajour syncs again from `cursor` with no changes.
 */
export const teamSyncResultSchema = z
  .object({
    cursor: cursorSchema,
    projects: z
      .array(teamProjectSchema)
      .max(TEAM_SYNC_MAX_PROJECTS)
      .superRefine(limitTotalTasks),
    assigned: z
      .array(teamRemoteIdAssignmentSchema)
      .max(TEAM_SYNC_MAX_PROJECTS + TEAM_SYNC_MAX_TASKS)
      .default([]),
    hasMore: z.boolean().default(false),
  })
  .superRefine((result, context) => {
    // A project appears once per page, and a task belongs to one project.
    refuseRepeats(
      result.projects.map((project, index) => ({
        value: project.remoteId,
        path: ["projects", index, "remoteId"],
      })),
      "Project",
      context,
    );
    refuseRepeats(
      result.projects.flatMap((project, index) =>
        project.tasks.map((task, taskIndex) => ({
          value: task.remoteId,
          path: ["projects", index, "tasks", taskIndex, "remoteId"],
        })),
      ),
      "Task",
      context,
    );
    refuseRepeats(
      result.assigned.map((entry, index) => ({
        value: entry.localId,
        path: ["assigned", index, "localId"],
      })),
      "Assigned local ID",
      context,
    );
  });
export type TeamSyncResult = z.infer<typeof teamSyncResultSchema>;

/** Creating a team. The plugin returns the values that join it. */
export const teamCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type TeamCreateRequest = z.infer<typeof teamCreateRequestSchema>;
