import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompts.ts";

describe("buildPrompt", () => {
  it("puts the runner rules first and fills the task's slots", () => {
    const prompt = buildPrompt({
      taskPrompt: "Enter week {{weekOf}} at {{settings.url}}.",
      values: {
        weekOf: "2026-10-12",
        sessionId: "s-1",
        "settings.url": "https://wd.example",
      },
    });
    expect(prompt.indexOf("Use the Ajour session s-1")).toBeLessThan(
      prompt.indexOf("Enter week 2026-10-12 at https://wd.example."),
    );
    expect(prompt).toContain("Never type a password");
  });

  it("tells the agent to mark each applied change as committed", () => {
    const prompt = buildPrompt({
      taskPrompt: "Commit the week.",
      values: { sessionId: "s-1" },
    });

    expect(prompt).toContain(
      "After the external tool saved a change, call mark_entries_committed with its entry ID. Never mark a change you did not apply.",
    );
    expect(prompt).not.toContain("mark_entries_submitted");
  });

  it("refuses a slot without a value", () => {
    expect(() =>
      buildPrompt({ taskPrompt: "{{settings.x}}", values: { sessionId: "s" } }),
    ).toThrow();
  });
});
