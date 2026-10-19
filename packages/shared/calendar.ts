import { z } from "zod";

/*
 * The calendar capability: a plugin provides the user's calendar events for a
 * date range, as provider-neutral facts. Read-only. Ajour turns them into
 * suggestions in the Time view and never stores them. See ADR 0005 and
 * docs/specs/2026-10-15-calendar-suggestions-design.md.
 *
 * Times are Unix milliseconds. A local date is YYYY-MM-DD.
 */

/** The longest range one request may ask for, in days, both ends included. */
export const MAX_CALENDAR_RANGE_DAYS = 62;
export const MAX_CALENDAR_EVENTS = 1_000;
export const MAX_CALENDAR_EVENT_TITLE_LENGTH = 200;

const DAY_MS = 24 * 60 * 60 * 1000;
const idSchema = z.string().trim().min(1).max(400);
const timeSchema = z.number().int().nonnegative();

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(time) && new Date(time).toISOString().startsWith(value)
    );
  }, "Use a real date as YYYY-MM-DD.");

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const calendarEventStatusSchema = z.enum([
  "confirmed",
  "tentative",
  "cancelled",
]);
export type CalendarEventStatus = z.infer<typeof calendarEventStatusSchema>;

/** The user's own reply to the event. `unknown` when the plugin cannot tell. */
export const calendarEventResponseSchema = z.enum([
  "accepted",
  "tentative",
  "declined",
  "needsAction",
  "unknown",
]);
export type CalendarEventResponse = z.infer<typeof calendarEventResponseSchema>;

/**
 * One occurrence of a calendar event. Nothing else about the event reaches
 * Ajour: no attendees, description, location or link (ADR 0005).
 */
export const calendarEventFactsSchema = z
  .object({
    /** The provider's id of the event, the UID in ICS. */
    eventId: idSchema,
    /** Shared by every occurrence of a recurring event. Absent for a one-off. */
    seriesId: idSchema.optional(),
    startsAt: timeSchema,
    endsAt: timeSchema,
    allDay: z.boolean(),
    /** Empty when the provider hides it. Longer titles are cut, not refused. */
    title: z
      .string()
      .transform((value) => value.trim())
      .transform((value) =>
        value.length > MAX_CALENDAR_EVENT_TITLE_LENGTH
          ? `${value.slice(0, MAX_CALENDAR_EVENT_TITLE_LENGTH - 1)}…`
          : value,
      ),
    status: calendarEventStatusSchema,
    response: calendarEventResponseSchema,
    /** False for an event marked free, such as a reminder. */
    busy: z.boolean(),
    isOrganizer: z.boolean().optional(),
  })
  .strip()
  .refine((event) => event.endsAt >= event.startsAt, {
    message: "An event cannot end before it starts.",
    path: ["endsAt"],
  });
export type CalendarEventFacts = z.infer<typeof calendarEventFactsSchema>;

/**
 * Identifies one occurrence across fetches: a recurring event's occurrences
 * share an `eventId`, so the start tells them apart.
 */
export function calendarOccurrenceKey(event: {
  eventId: string;
  startsAt: number;
}) {
  return JSON.stringify([event.eventId, event.startsAt]);
}

export const calendarListEventsRequestSchema = z
  .object({
    /** The first local date of the range. */
    from: localDateSchema,
    /** The last local date of the range, included. */
    to: localDateSchema,
    /** The IANA time zone the plugin uses for floating times and all-day dates. */
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(isTimeZone, "Use an IANA time zone, such as America/Toronto."),
  })
  .superRefine((request, context) => {
    const from = Date.parse(`${request.from}T00:00:00Z`);
    const to = Date.parse(`${request.to}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    if (to < from) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The range ends before it starts.",
      });
      return;
    }
    if ((to - from) / DAY_MS + 1 > MAX_CALENDAR_RANGE_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `A range covers at most ${MAX_CALENDAR_RANGE_DAYS} days.`,
      });
    }
  });
export type CalendarListEventsRequest = z.infer<
  typeof calendarListEventsRequestSchema
>;

export const calendarListEventsResultSchema = z.object({
  /** Every occurrence that overlaps the range, cancelled ones included. */
  events: z.array(calendarEventFactsSchema).max(MAX_CALENDAR_EVENTS),
});
export type CalendarListEventsResult = z.infer<
  typeof calendarListEventsResultSchema
>;

/**
 * Every calendar operation, keyed by the function name the plugin exports.
 * Each export receives the connection and the parsed request.
 */
export const calendarOperations = {
  listCalendarEvents: {
    request: calendarListEventsRequestSchema,
    result: calendarListEventsResultSchema,
  },
} as const;

export type CalendarOperation = keyof typeof calendarOperations;

export const calendarOperationSchema = z.enum(
  Object.keys(calendarOperations) as [
    CalendarOperation,
    ...CalendarOperation[],
  ],
);

export type CalendarOperationRequest<Operation extends CalendarOperation> =
  z.input<(typeof calendarOperations)[Operation]["request"]>;
export type CalendarOperationResult<Operation extends CalendarOperation> =
  z.infer<(typeof calendarOperations)[Operation]["result"]>;
