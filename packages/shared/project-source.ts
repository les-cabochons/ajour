import { z } from "zod";

/*
 * The project source capability, plugin API 4 (spec #502, #504): a plugin
 * hands Ajour a read-only snapshot of the user's projects, their tasks,
 * assignments and budgets, as its source knows them. Ajour never writes to
 * a project source. Nothing here names a product: the plugin supplies the
 * source's label and URLs, and Ajour shows them wherever it names the
 * source.
 *
 * The plugin exports `syncProjects(connection, { cursor })` and answers
 * `{ snapshot, cursor }` or `{ unchanged: true }`. The cursor is opaque to
 * Ajour, such as an ETag: Ajour keeps the last one per connection and hands
 * it back on the next sync.
 */

/** What a plugin exports for the capability. `plugin-methods.ts` passes the arguments. */
export const projectSourceMethods = ["syncProjects"] as const;
export type ProjectSourceMethod = (typeof projectSourceMethods)[number];

/**
 * The capability's manifest entry. Version 1 has no option, and refuses
 * one so a later option is never silently ignored.
 */
export const projectSourceCapabilitySchema = z.object({}).strict();
export type ProjectSourceCapability = z.infer<
  typeof projectSourceCapabilitySchema
>;

/** Projects in one snapshot: the user's own, so a few dozen at most. */
export const PROJECT_SOURCE_MAX_PROJECTS = 200;
/**
 * Tasks in one snapshot, across all its projects. With the field bounds
 * below, a worst-case snapshot stays well under the worker's 8 MiB result
 * limit.
 */
export const PROJECT_SOURCE_MAX_TASKS = 10_000;

/** The ID the source gives a project or task. Stable across renames. */
const remoteIdSchema = z.string().trim().min(1).max(100);
const nameSchema = z.string().trim().min(1).max(240);
/** Ajour opens it in the browser, so only an absolute https address will do. */
const httpsUrlSchema = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "A project source URL is an absolute https address.");
/** A calendar date that exists, such as 2026-01-31. The time sync uses it too. */
export const calendarDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}, "Use an existing date, YYYY-MM-DD.");
const hoursSchema = z.number().finite().nonnegative();

/** The source's own health reading of a budget. */
export const projectSourceBudgetStatusSchema = z.enum([
  "ok",
  "warning",
  "over",
  "unknown",
]);
export type ProjectSourceBudgetStatus = z.infer<
  typeof projectSourceBudgetStatusSchema
>;

/**
 * A project's budget as of the snapshot's `asOf`. The source is the one
 * writer of every figure here; Ajour adds what the source cannot know yet.
 * `remaining` may be negative: `status` says whether that is over.
 */
export const projectSourceBudgetSchema = z.object({
  unit: z.enum(["hours", "money"]),
  total: z.number().finite().nonnegative().optional(),
  consumed: z.number().finite().nonnegative(),
  remaining: z.number().finite().optional(),
  status: projectSourceBudgetStatusSchema.optional(),
  /**
   * The first day `consumed` covers, when the budget covers a period. Ajour
   * counts the user's entries from that day only. Without it, all count.
   */
  since: calendarDateSchema.optional(),
});
export type ProjectSourceBudget = z.infer<typeof projectSourceBudgetSchema>;

export const projectSourceTaskSchema = z.object({
  remoteId: remoteIdSchema,
  name: nameSchema,
  /** How the source groups the project's tasks, such as a phase. */
  group: z.string().trim().min(1).max(120).optional(),
  closed: z.boolean(),
  billable: z.boolean().optional(),
  estimateHours: hoursSchema.optional(),
  /** Whether the source assigns the task to the user. */
  assigned: z.boolean(),
  /** The user's hours on the task as the source counts them, when it can. */
  myHours: hoursSchema.optional(),
});
export type ProjectSourceTask = z.infer<typeof projectSourceTaskSchema>;

export const projectSourceProjectSchema = z.object({
  remoteId: remoteIdSchema,
  name: nameSchema,
  code: z.string().trim().min(1).max(120),
  /** Where "Open in <source>" goes. */
  url: httpsUrlSchema.optional(),
  client: z.string().trim().min(1).max(240).optional(),
  /** The source marks it complete, so Ajour archives it. */
  complete: z.boolean(),
  startsOn: calendarDateSchema.optional(),
  endsOn: calendarDateSchema.optional(),
  budget: projectSourceBudgetSchema.optional(),
  /** Every task of the project, the ones not assigned to the user included. */
  tasks: z.array(projectSourceTaskSchema).max(PROJECT_SOURCE_MAX_TASKS),
});
export type ProjectSourceProject = z.infer<typeof projectSourceProjectSchema>;

/**
 * Whether the source can give the user's own hours (`myHours`), and from
 * which day.
 */
export const projectSourceMeSchema = z.object({
  /** Whether `myHours` can be known. When not, `hoursNote` says why. */
  hoursAvailable: z.boolean(),
  /** The plugin's sentence for the user, such as how to link their account. */
  hoursNote: z.string().trim().min(1).max(300).optional(),
  /**
   * The first day the tasks' `myHours` cover, such as the first of the
   * month. Ajour compares the user's entries from that day only.
   * Without it, all count.
   */
  hoursSince: calendarDateSchema.optional(),
});
export type ProjectSourceMe = z.infer<typeof projectSourceMeSchema>;

export const projectSourceSnapshotSchema = z
  .object({
    source: z.object({
      /** What Ajour calls the source, such as in "From <label>". */
      label: z.string().trim().min(1).max(80),
      /** The source's home, for a link that names it. */
      url: httpsUrlSchema.optional(),
    }),
    /** When the source's figures are from: its hours lag the user's entries. */
    asOf: z.string().datetime({ offset: true }),
    me: projectSourceMeSchema.optional(),
    projects: z
      .array(projectSourceProjectSchema)
      .max(PROJECT_SOURCE_MAX_PROJECTS),
  })
  .superRefine((snapshot, context) => {
    const projectIds = new Set<string>();
    let taskCount = 0;
    snapshot.projects.forEach((project, projectIndex) => {
      if (projectIds.has(project.remoteId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projects", projectIndex, "remoteId"],
          message: `Two projects use the remote id "${project.remoteId}".`,
        });
      }
      projectIds.add(project.remoteId);
      taskCount += project.tasks.length;
      const taskIds = new Set<string>();
      project.tasks.forEach((task, taskIndex) => {
        if (taskIds.has(task.remoteId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["projects", projectIndex, "tasks", taskIndex, "remoteId"],
            message: `Two tasks of project "${project.remoteId}" use the remote id "${task.remoteId}".`,
          });
        }
        taskIds.add(task.remoteId);
      });
    });
    if (taskCount > PROJECT_SOURCE_MAX_TASKS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projects"],
        message: `A snapshot holds at most ${PROJECT_SOURCE_MAX_TASKS} tasks, not ${taskCount}.`,
      });
    }
  });
export type ProjectSourceSnapshot = z.infer<typeof projectSourceSnapshotSchema>;

const cursorSchema = z.string().min(1).max(2_000);

/**
 * What `syncProjects` receives: the cursor Ajour kept, absent on the first
 * sync, and what started the sync (#686). `manual` is a sync the user asked
 * for, such as Sync now: a plugin that answers from a cache should read the
 * source. `auto` is the scheduler's. Ajour before #686 sends no trigger.
 */
export const projectSourceSyncRequestSchema = z.object({
  cursor: cursorSchema.optional(),
  trigger: z.enum(["manual", "auto"]).optional(),
});
export type ProjectSourceSyncRequest = z.infer<
  typeof projectSourceSyncRequestSchema
>;

const projectSourceUnchangedResultSchema = z.object({
  unchanged: z.literal(true),
});
const projectSourceSnapshotResultSchema = z.object({
  snapshot: projectSourceSnapshotSchema,
  /** The cursor to send next time. Without one, the next sync starts over. */
  cursor: cursorSchema.optional(),
});

/**
 * What `syncProjects` answers: the snapshot and the cursor to send next
 * time, or that nothing changed since the cursor it received.
 */
export const projectSourceSyncResultSchema = z.union([
  projectSourceUnchangedResultSchema,
  projectSourceSnapshotResultSchema,
]);
export type ProjectSourceSyncResult = z.infer<
  typeof projectSourceSyncResultSchema
>;

/** `snapshot.projects[0].tasks[1].name`, as a person reads a path. */
export function describePath(path: readonly (string | number)[]) {
  return path.reduce<string>(
    (text, part) =>
      typeof part === "number"
        ? `${text}[${part}]`
        : text
          ? `${text}.${part}`
          : part,
    "",
  );
}

/**
 * Parses a result along the branch its `unchanged` picks, so a bad snapshot
 * is refused with its path in one sentence, instead of a union's two sets
 * of issues.
 */
export function parseProjectSourceSyncResult(
  value: unknown,
): ProjectSourceSyncResult {
  const unchanged =
    typeof value === "object" &&
    value !== null &&
    (value as { unchanged?: unknown }).unchanged === true;
  const parsed = unchanged
    ? projectSourceUnchangedResultSchema.safeParse(value)
    : projectSourceSnapshotResultSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues
    .map((issue) => `${describePath(issue.path)}: ${issue.message}`)
    .join("; ");
  throw new Error(`The plugin's result is not valid: ${problems}.`);
}
