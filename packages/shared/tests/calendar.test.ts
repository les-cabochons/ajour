import { describe, expect, it } from "vitest";
import {
  MAX_CALENDAR_EVENT_TITLE_LENGTH,
  calendarEventFactsSchema,
  calendarListEventsRequestSchema,
  calendarListEventsResultSchema,
  calendarOccurrenceKey,
  calendarOperationSchema,
} from "../calendar";

const standup = {
  eventId: "standup@google.com",
  seriesId: "standup@google.com",
  startsAt: Date.UTC(2026, 9, 15, 13, 0),
  endsAt: Date.UTC(2026, 9, 15, 13, 15),
  allDay: false,
  title: "Daily standup",
  status: "confirmed",
  response: "accepted",
  busy: true,
};

const week = {
  from: "2026-10-12",
  to: "2026-10-18",
  timeZone: "America/Toronto",
};

describe("calendar contract", () => {
  it("accepts event facts and drops every field outside the contract", () => {
    const [event] = calendarListEventsResultSchema.parse({
      events: [
        {
          ...standup,
          attendees: ["maria@example.com"],
          description: "Agenda",
          location: "Room 4",
          url: "https://meet.example.com/abc",
        },
      ],
    }).events;

    expect(event).toEqual(standup);
  });

  it("cuts a long title instead of refusing the event", () => {
    const event = calendarEventFactsSchema.parse({
      ...standup,
      title: `  ${"x".repeat(MAX_CALENDAR_EVENT_TITLE_LENGTH + 50)}  `,
    });

    expect(event.title).toHaveLength(MAX_CALENDAR_EVENT_TITLE_LENGTH);
    expect(event.title.endsWith("…")).toBe(true);
  });

  it("accepts an empty title and a zero-length event", () => {
    expect(
      calendarEventFactsSchema.parse({
        ...standup,
        title: "",
        endsAt: standup.startsAt,
      }).title,
    ).toBe("");
  });

  it("refuses an event that ends before it starts", () => {
    expect(() =>
      calendarEventFactsSchema.parse({
        ...standup,
        endsAt: standup.startsAt - 1,
      }),
    ).toThrow("cannot end before it starts");
  });

  it("tells occurrences of one recurring event apart by their start", () => {
    const tomorrow = {
      ...standup,
      startsAt: standup.startsAt + 86_400_000,
    };

    expect(calendarOccurrenceKey(standup)).not.toBe(
      calendarOccurrenceKey(tomorrow),
    );
    expect(calendarOccurrenceKey(standup)).toBe(
      calendarOccurrenceKey({ ...standup }),
    );
  });

  it("accepts a week in an IANA time zone", () => {
    expect(calendarListEventsRequestSchema.parse(week)).toEqual(week);
  });

  it("refuses ranges that end first, run too long or use unreal dates", () => {
    expect(() =>
      calendarListEventsRequestSchema.parse({ ...week, to: "2026-10-11" }),
    ).toThrow("ends before it starts");
    expect(() =>
      calendarListEventsRequestSchema.parse({ ...week, to: "2026-12-13" }),
    ).toThrow("at most 62 days");
    expect(
      calendarListEventsRequestSchema.parse({ ...week, to: "2026-12-12" }).to,
    ).toBe("2026-12-12");
    expect(() =>
      calendarListEventsRequestSchema.parse({ ...week, from: "2026-02-30" }),
    ).toThrow("real date");
  });

  it("refuses a time zone that is not an IANA name", () => {
    expect(() =>
      calendarListEventsRequestSchema.parse({ ...week, timeZone: "Mars/Base" }),
    ).toThrow("IANA time zone");
  });

  it("names its operations", () => {
    expect(calendarOperationSchema.options).toEqual(["listCalendarEvents"]);
  });
});
