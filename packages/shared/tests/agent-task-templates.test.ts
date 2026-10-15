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
