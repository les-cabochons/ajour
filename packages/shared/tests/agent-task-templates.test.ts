import { describe, expect, it } from "vitest";
import {
  fillTemplate,
  listTemplateSlots,
  UnknownSlotError,
} from "../agent-task-templates.ts";

describe("agent task templates", () => {
  it("lists each slot once, in order", () => {
    expect(
      listTemplateSlots("{{weekOf}} {{settings.timesheetUrl}} {{weekOf}}"),
    ).toEqual(["weekOf", "settings.timesheetUrl"]);
  });

  it("fills known slots and leaves other braces alone", () => {
    expect(
      fillTemplate("Week {{weekOf}} at {{settings.url}} {not a slot}", {
        weekOf: "2026-10-12",
        "settings.url": "https://wd.example/t",
      }),
    ).toBe("Week 2026-10-12 at https://wd.example/t {not a slot}");
  });

  it("refuses a slot it has no value for", () => {
    expect(() => fillTemplate("{{settings.missing}}", {})).toThrow(
      UnknownSlotError,
    );
  });
});

it("keeps prose and JSX braces literal while allowing spaced identifiers", () => {
  const literal = "{{ the week }} style={{ color: 'red' }}";
  expect(listTemplateSlots(literal)).toEqual([]);
  expect(fillTemplate(literal + " {{ weekOf }}", { weekOf: "Monday" })).toBe(
    literal + " Monday",
  );
});

it("preserves hyphenated agent-task setting identifiers", () => {
  expect(
    fillTemplate("{{ settings.week-url }}", {
      "settings.week-url": "https://example.test",
    }),
  ).toBe("https://example.test");
});
it("rejects an unknown week-link filter when parsing the manifest", async () => {
  const { agentTaskSchema } = await import("../plugins.ts");
  expect(
    agentTaskSchema.safeParse({
      id: "task",
      label: "Task",
      placement: "commit-week",
      prompt: "prompt.md",
      estimateMinutes: 1,
      weekLink: "https://example.test/{{weekOf|bogus}}",
    }).success,
  ).toBe(false);
});
