import { expect, it } from "vitest";
import {
  fillHandoffTemplates,
  handoffTemplatesSchema,
} from "../handoff-templates.ts";
it("fills every item slot, strips frontmatter and applies slug", () => {
  const templates = {
    prompt:
      "{{item.key}} {{item.title}} {{item.description}} {{item.url}} {{item.type}} {{item.parent.key}} {{item.parent.title}} {{project.name}} {{repo.name}}",
    title: "{{item.title|slug}}",
    branch: "{{item.key|slug}}",
  };
  expect(
    fillHandoffTemplates(templates, {
      item: {
        key: "PAY-12",
        title: "\u00c9t\u00e9, d\u00e9j\u00e0!",
        description: "---\ntimelog: test\n---\nBody",
        url: "https://x",
        type: "Bug",
        parent: { key: "P", title: "Parent" },
      },
      projectName: "Project",
      repoName: "Repo",
    }),
  ).toEqual({
    prompt:
      "PAY-12 \u00c9t\u00e9, d\u00e9j\u00e0! Body https://x Bug P Parent Project Repo",
    title: "ete-deja",
    branch: "pay-12",
  });
});

it("refuses unknown slots and filters by name on save", () => {
  for (const slot of [
    "item.nope",
    "settings.token",
    "item.key|upper",
    "item.key|bogus-filter",
    "toString",
  ])
    expect(
      handoffTemplatesSchema.safeParse({
        prompt: `{{${slot}}}`,
        title: "T",
        branch: "B",
      }).success,
    ).toBe(false);
});
it("bounds UTF-8 descriptions without cutting a character and supplies missing fields", async () => {
  const { handoffDescription, handoffTemplateDefaults } =
    await import("../handoff-templates.ts");
  expect(handoffDescription()).toBe("");
  const cut = handoffDescription("\u{1f600}".repeat(9000));
  expect(new TextEncoder().encode(cut).length).toBe(32768);
  expect(cut.endsWith("\n\u2026")).toBe(true);
  expect(cut).not.toContain("\ufffd");
  expect(handoffDescription("a".repeat(32768))).toHaveLength(32768);
  expect(
    fillHandoffTemplates(
      {
        ...handoffTemplateDefaults(),
        prompt: "{{item.parent.key}}{{item.parent.title}}{{item.description}}",
      },
      {
        item: { key: "X", title: "Title", url: "", type: "" },
        projectName: "",
        repoName: "",
      },
    ),
  ).toEqual({ prompt: "", title: "[X] Title", branch: "x-title" });
});
it("slugs punctuation, accents, length and empty values", async () => {
  const { slug } = await import("../agent-task-templates.ts");
  expect(slug("\u00c9t\u00e9, d\u00e9j\u00e0! ")).toBe("ete-deja");
  expect(slug("--- !!!")).toBe("item");
  expect(slug("a".repeat(59) + " bbbbb")).toBe("a".repeat(59));
  expect(slug("x".repeat(90))).toHaveLength(60);
});

it("accepts a plugin prompt default and enforces byte limits", async () => {
  const { handoffTemplateDefaults } = await import("../handoff-templates.ts");
  expect(handoffTemplateDefaults("Plugin {{item.key}}").prompt).toBe(
    "Plugin {{item.key}}",
  );
  expect(
    handoffTemplatesSchema.safeParse({
      ...handoffTemplateDefaults(),
      prompt: "x".repeat(16384),
    }).success,
  ).toBe(true);
  expect(
    handoffTemplatesSchema.safeParse({
      ...handoffTemplateDefaults(),
      prompt: "\u00e9".repeat(8193),
    }).success,
  ).toBe(false);
});

it("does not recursively fill item text", () => {
  expect(
    fillHandoffTemplates(
      { prompt: "{{item.description}}", title: "{{item.title}}", branch: "" },
      {
        item: {
          key: "K",
          title: "{{repo.name}}",
          description: "{{item.title}}",
          url: "",
          type: "",
        },
        projectName: "P",
        repoName: "R",
      },
    ),
  ).toEqual({ prompt: "{{item.title}}", title: "{{repo.name}}", branch: "" });
});
