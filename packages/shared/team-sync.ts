import { z } from "zod";

/*
 * The team capability: a plugin keeps the shared projects of a team in step
 * between the workspaces of its members. Each sync sends the team-owned fields
 * that changed since the last sync, then receives the team's changes since a
 * cursor, so the later write to a field wins. See ADR 0005 and
 * docs/superpowers/specs/2026-10-16-team-project-sync-design.md.
 *
 * Only team-owned fields cross this boundary. Time entries, tracked totals,
 * notes, budget consumption, pinned slots, plugin properties, order and the
 * budget adjustment never do.
 */

export const TEAM_CAPABILITY_API_VERSION = 1;

/** Projects in one sync request or one page of a result. */
export const TEAM_SYNC_MAX_PROJECTS = 25;
/** Tasks of one project. Keeps a page under the worker's result limit. */
export const TEAM_SYNC_MAX_TASKS_PER_PROJECT = 500;

export const teamCapabilitySchema = z.object({
  apiVersion: z.literal(TEAM_CAPABILITY_API_VERSION),
});
export type TeamCapability = z.infer<typeof teamCapabilitySchema>;

/** A local project or task ID. It never changes, so time entries keep it. */
const localIdSchema = z.string().trim().min(1).max(200);
/** The ID the team gave a shared project or task. */
const remoteIdSchema = z.string().trim().min(1).max(200);
const cursorSchema = z.string().min(1).max(2_000);
const statusSchema = z.enum(["active", "archived"]);
/** Uploaded icons are 32 pixel PNG images, a few KB each. */
const iconImageSchema = z.string().startsWith("data:image/").max(16_384);

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

/** The team-owned fields of a project. Null clears a value. */
const teamProjectFields = {
  name: z.string().trim().min(1).max(240),
  displayName: z.string().trim().min(1).max(240),
  code: z.string().trim().min(1).max(120).nullable(),
  color: z.string().trim().min(1).max(60),
  icon: teamProjectIconSchema,
  status: statusSchema,
};

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

/**
 * A task change to push. Without `remoteId` the task is new and carries every
 * field. With it, only the fields changed since the last sync, so a field a
 * teammate changed meanwhile keeps their value.
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
 * A project change to push, with the same rule as a task. A change to an
 * existing project may carry only task changes.
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
    tasks: z
      .array(teamTaskChangeSchema)
      .max(TEAM_SYNC_MAX_TASKS_PER_PROJECT)
      .default([]),
  })
  .superRefine(requireAllFieldsWhenNew(Object.keys(teamProjectFields)));
export type TeamProjectChange = z.infer<typeof teamProjectChangeSchema>;

export const teamTaskSchema = z.object({
  remoteId: remoteIdSchema,
  ...teamTaskFields,
});
export type TeamTask = z.infer<typeof teamTaskSchema>;

/** A team project as the team has it now, with all its tasks. */
export const teamProjectSchema = z.object({
  remoteId: remoteIdSchema,
  ...teamProjectFields,
  tasks: z.array(teamTaskSchema).max(TEAM_SYNC_MAX_TASKS_PER_PROJECT),
});
export type TeamProject = z.infer<typeof teamProjectSchema>;

/**
 * One sync round. Without a cursor the result starts from the whole team,
 * which is what the picker shows before anything is shared.
 */
export const teamSyncRequestSchema = z.object({
  cursor: cursorSchema.optional(),
  changes: z
    .array(teamProjectChangeSchema)
    .max(TEAM_SYNC_MAX_PROJECTS)
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
export const teamSyncResultSchema = z.object({
  cursor: cursorSchema,
  projects: z.array(teamProjectSchema).max(TEAM_SYNC_MAX_PROJECTS),
  assigned: z
    .array(teamRemoteIdAssignmentSchema)
    .max(TEAM_SYNC_MAX_PROJECTS * (1 + TEAM_SYNC_MAX_TASKS_PER_PROJECT))
    .default([]),
  hasMore: z.boolean().default(false),
});
export type TeamSyncResult = z.infer<typeof teamSyncResultSchema>;

/** Creating a team. The plugin returns the values that join it. */
export const teamCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type TeamCreateRequest = z.infer<typeof teamCreateRequestSchema>;
