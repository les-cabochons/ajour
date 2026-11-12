import { z } from "zod";
import { calendarDateSchema, describePath } from "./project-source.ts";

/*
 * The time sync capability, plugin API 4 (spec #685, #691): a plugin keeps
 * a live copy of the user's time entries in another system, both ways. A
 * time sync is not a commit: the timesheet tool still gets a week only
 * through Commit and Submit week (ADR 0018). Only entries on projects the
 * same connection manages take part, so the capability needs
 * `projectSource`. Nothing here names a product.
 *
 * The plugin exports `syncTimeEntries(connection, request)`, which runs one
 * round: it applies the changes in order, then lists the remote entries in
 * the window, and answers both.
 */

/** What a plugin exports for the capability. `plugin-methods.ts` passes the arguments. */
export const timeSyncMethods = ["syncTimeEntries"] as const;
export type TimeSyncMethod = (typeof timeSyncMethods)[number];

/**
 * The capability's manifest entry. Version 1 has no option, and refuses
 * one so a later option is never silently ignored.
 */
export const timeSyncCapabilitySchema = z.object({}).strict();
export type TimeSyncCapability = z.infer<typeof timeSyncCapabilitySchema>;

/**
 * Changes in one round. It keeps a round within the request rate a
 * service allows, such as 10 a second with a burst of 20.
 */
export const TIME_SYNC_MAX_CHANGES = 20;
/**
 * Remote entries in one answer. The window is five weeks of one person's
 * entries, a few hundred at most.
 */
export const TIME_SYNC_MAX_ENTRIES = 2_000;

/** An ID the other system gives, such as a time entry's or a project's. */
const remoteIdSchema = z.string().trim().min(1).max(100);
/** Ajour's stable key for one entry. The plugin sends it as its client reference. */
const syncKeySchema = z.string().trim().min(1).max(100);
const instantSchema = z.string().datetime({ offset: true });

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * One entry's values, as both sides compare them. Ajour's note never
 * leaves Ajour, so there is none.
 */
const entryValuesShape = {
  /** The entry's day, in the user's time zone. */
  localDate: calendarDateSchema,
  /** Whole minutes: both sides compare in minutes, so seconds never make a change. */
  minutes: z.number().int().nonnegative(),
  running: z.boolean(),
  /**
   * Only when running: the instant the count would have started from zero,
   * so the other system's elapsed time matches Ajour's.
   */
  countingSince: instantSchema.optional(),
  /** The project's remote id in the project source of the same connection. */
  projectRemoteId: remoteIdSchema,
  /** The task's name as a commit would send it. */
  taskName: z.string().trim().min(1).max(240),
  /** The task's remote id, when the task came from the project source. */
  taskRemoteId: remoteIdSchema.optional(),
};

/** A running entry says when its count started. */
function requireCountingSince(
  values: { running: boolean; countingSince?: string },
  context: z.RefinementCtx,
) {
  if (values.running && values.countingSince === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["countingSince"],
      message: "A running entry says when its count started.",
    });
  }
}

export const timeSyncEntryValuesSchema = z
  .object(entryValuesShape)
  .superRefine(requireCountingSince);
export type TimeSyncEntryValues = z.infer<typeof timeSyncEntryValuesSchema>;

const changeKeyShape = {
  /**
   * Stays the same for the life of the entry, also when a running entry is
   * saved. Send it as the client reference, so a retry never duplicates.
   */
  syncKey: syncKeySchema,
  /** The remote entry's id, when Ajour knows it. */
  remoteId: remoteIdSchema.optional(),
  /**
   * The values both sides last agreed on, when there are some. Use them to
   * keep what Ajour doesn't own, such as a real start time.
   */
  agreed: timeSyncEntryValuesSchema.optional(),
};

/** One change Ajour sends: an entry to create or update, or one to delete. */
export const timeSyncChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("upsert"),
    ...changeKeyShape,
    /** The entry's values in Ajour now. */
    values: timeSyncEntryValuesSchema,
  }),
  z.object({ kind: z.literal("delete"), ...changeKeyShape }),
]);
export type TimeSyncChange = z.infer<typeof timeSyncChangeSchema>;

/**
 * What `syncTimeEntries` receives: the window to list, as local dates in
 * the user's time zone, and the changes to apply first, in order.
 */
export const timeSyncRequestSchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    /** The user's IANA time zone, such as America/Toronto. */
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine(isTimeZone, "Use an IANA time zone, such as America/Toronto."),
    changes: z.array(timeSyncChangeSchema).max(TIME_SYNC_MAX_CHANGES),
  })
  .superRefine((request, context) => {
    if (request.to < request.from) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The window ends on or after the day it starts.",
      });
    }
    const keys = new Set<string>();
    request.changes.forEach((change, index) => {
      if (keys.has(change.syncKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["changes", index, "syncKey"],
          message: `Two changes use the sync key "${change.syncKey}".`,
        });
      }
      keys.add(change.syncKey);
    });
  });
export type TimeSyncRequest = z.infer<typeof timeSyncRequestSchema>;

/** An entry as the other system stores it. */
export const timeSyncRemoteEntrySchema = z
  .object({
    remoteId: remoteIdSchema,
    /** The sync key Ajour sent when Ajour created it. Absent for one logged elsewhere. */
    clientRef: syncKeySchema.optional(),
    ...entryValuesShape,
    /** When the other system last changed it. The later change wins a conflict. */
    updatedAt: instantSchema,
  })
  .superRefine(requireCountingSince);
export type TimeSyncRemoteEntry = z.infer<typeof timeSyncRemoteEntrySchema>;

/** What the user reads when a change is refused or failed, in the plugin's words. */
const changeMessageSchema = z.string().trim().min(1).max(300);

/**
 * How one change went. `synced` carries the remote entry as stored, except
 * for a delete. `refused` is final: Ajour shows the message and sends the
 * entry again only once it changes. `failed` is retried next round.
 */
export const timeSyncChangeResultSchema = z.discriminatedUnion("status", [
  z.object({
    syncKey: syncKeySchema,
    status: z.literal("synced"),
    entry: timeSyncRemoteEntrySchema.optional(),
  }),
  z.object({
    syncKey: syncKeySchema,
    status: z.literal("refused"),
    message: changeMessageSchema,
  }),
  z.object({
    syncKey: syncKeySchema,
    status: z.literal("failed"),
    message: changeMessageSchema,
  }),
]);
export type TimeSyncChangeResult = z.infer<typeof timeSyncChangeResultSchema>;

/**
 * What `syncTimeEntries` answers: one result per change, and the remote
 * entries in the window after the changes.
 */
export const timeSyncResultSchema = z.object({
  results: z.array(timeSyncChangeResultSchema).max(TIME_SYNC_MAX_CHANGES),
  entries: z.array(timeSyncRemoteEntrySchema).max(TIME_SYNC_MAX_ENTRIES),
});
export type TimeSyncResult = z.infer<typeof timeSyncResultSchema>;

/**
 * Parses a plugin's answer to `request`. A bad field, a change without a
 * result, a second result for one change, or a synced upsert without the
 * entry is refused with its path, in one sentence.
 */
export function parseTimeSyncResult(
  value: unknown,
  request: Pick<TimeSyncRequest, "changes">,
): TimeSyncResult {
  const refuse = (problems: string[]): never => {
    throw new Error(
      `The plugin's result is not valid: ${problems.join("; ")}.`,
    );
  };
  const parsed = timeSyncResultSchema.safeParse(value);
  if (!parsed.success) {
    refuse(
      parsed.error.issues.map(
        (issue) => `${describePath(issue.path)}: ${issue.message}`,
      ),
    );
  }
  const result = parsed.data!;
  const changes = new Map(
    request.changes.map((change) => [change.syncKey, change]),
  );
  const answered = new Set<string>();
  const problems: string[] = [];
  result.results.forEach((answer, index) => {
    const change = changes.get(answer.syncKey);
    if (!change) {
      problems.push(
        `results[${index}].syncKey: no change "${answer.syncKey}" was sent`,
      );
    } else if (answered.has(answer.syncKey)) {
      problems.push(
        `results[${index}].syncKey: a second result for the change "${answer.syncKey}"`,
      );
    } else if (
      answer.status === "synced" &&
      change.kind === "upsert" &&
      !answer.entry
    ) {
      problems.push(
        `results[${index}].entry: the change "${answer.syncKey}" is an upsert, so its synced result carries the entry as stored`,
      );
    }
    answered.add(answer.syncKey);
  });
  for (const syncKey of changes.keys()) {
    if (!answered.has(syncKey)) {
      problems.push(`results: no result for the change "${syncKey}"`);
    }
  }
  if (problems.length > 0) refuse(problems);
  return result;
}
