import { describe, expect, it } from "vitest";
import {
  getDescriptionTimelog,
  isFrontmatterLink,
  isSameTimelog,
  splitDescription,
} from "@/domain/backlog/description-frontmatter";

describe("splitDescription", () => {
  it("reads fields and the timelog, and returns the text after the block", () => {
    const split = splitDescription(
      [
        "---",
        "Teamwork: https://acme.teamwork.com/app/tasks/123",
        "timelog:",
        "  project: Acme website",
        "  task: Development",
        "---",
        "",
        "The description text.",
      ].join("\n"),
    );

    expect(split).toEqual({
      frontmatter: {
        fields: [
          {
            key: "Teamwork",
            values: ["https://acme.teamwork.com/app/tasks/123"],
          },
        ],
        timelog: { project: "Acme website", task: "Development" },
      },
      body: "The description text.",
    });
  });

  it("leaves a description without a block as it is", () => {
    expect(splitDescription("Plain text\n\n---\nkey: value\n---")).toEqual({
      frontmatter: null,
      body: "Plain text\n\n---\nkey: value\n---",
    });
  });

  it("is not frontmatter when the block never closes", () => {
    const description = "---\nTeamwork: https://example.com\n\nMore text";
    expect(splitDescription(description)).toEqual({
      frontmatter: null,
      body: description,
    });
  });

  it("is not frontmatter when a line is not YAML, such as a setext heading", () => {
    const description = "---\nA heading\n---\nText";
    expect(splitDescription(description).frontmatter).toBeNull();
  });

  it("reads Windows line endings and an empty body", () => {
    expect(splitDescription("---\r\nOwner: Ada\r\n---\r\n")).toEqual({
      frontmatter: { fields: [{ key: "Owner", values: ["Ada"] }] },
      body: "",
    });
  });

  it("ends the block at a YAML document end marker", () => {
    expect(splitDescription("---\nOwner: Ada\n...\nText").body).toBe("Text");
  });

  it("reads quoted values and drops comments, but keeps # inside a link", () => {
    const split = splitDescription(
      [
        "---",
        "# Where the task lives",
        'Quoted: "a: b # not a comment"',
        "Single: 'it''s'",
        "Link: https://acme.teamwork.com/#/tasks/1 # the task",
        "---",
      ].join("\n"),
    );

    expect(split.frontmatter?.fields).toEqual([
      { key: "Quoted", values: ["a: b # not a comment"] },
      { key: "Single", values: ["it's"] },
      { key: "Link", values: ["https://acme.teamwork.com/#/tasks/1"] },
    ]);
  });

  it("reads block and flow lists", () => {
    const split = splitDescription(
      [
        "---",
        "Links:",
        "  - https://one.example",
        "  - https://two.example",
        "Tags: [alpha, 'beta, gamma']",
        "Owners:",
        "- Ada",
        "---",
      ].join("\n"),
    );

    expect(split.frontmatter?.fields).toEqual([
      { key: "Links", values: ["https://one.example", "https://two.example"] },
      { key: "Tags", values: ["alpha", "beta, gamma"] },
      { key: "Owners", values: ["Ada"] },
    ]);
  });

  it("names a nested field by its path and skips empty values", () => {
    const split = splitDescription(
      [
        "---",
        "Client:",
        "  Name: Acme",
        "  Contact:",
        "    Email: ada@acme.test",
        "Empty:",
        "---",
      ].join("\n"),
    );

    expect(split.frontmatter?.fields).toEqual([
      { key: "Client.Name", values: ["Acme"] },
      { key: "Client.Contact.Email", values: ["ada@acme.test"] },
    ]);
  });

  it("is not frontmatter when the indentation does not nest", () => {
    expect(
      splitDescription("---\nOwner: Ada\n  Extra: value\n---").frontmatter,
    ).toBeNull();
    expect(
      splitDescription("---\nOwner:\n\tName: Ada\n---").frontmatter,
    ).toBeNull();
  });

  it("is not frontmatter when a list holds a map", () => {
    expect(
      splitDescription("---\nPeople:\n  - name: Ada\n---").frontmatter,
    ).toBeNull();
  });

  it("hides an empty block", () => {
    expect(splitDescription("---\n---\nText")).toEqual({
      frontmatter: { fields: [] },
      body: "Text",
    });
  });
});

describe("getDescriptionTimelog", () => {
  it("reads the timelog whatever the case of its keys", () => {
    expect(
      getDescriptionTimelog(
        "---\nTimelog:\n  Project: ' Acme '\n  TASK: Design\n---",
      ),
    ).toEqual({ project: "Acme", task: "Design" });
  });

  it("keeps a timelog with only a project or only a task", () => {
    expect(
      getDescriptionTimelog("---\ntimelog:\n  project: Acme\n---"),
    ).toEqual({ project: "Acme" });
    expect(getDescriptionTimelog("---\ntimelog:\n  task: Design\n---")).toEqual(
      {
        task: "Design",
      },
    );
  });

  it("has no timelog without a project or task, or without a block", () => {
    expect(getDescriptionTimelog("---\ntimelog: Acme\n---")).toBeUndefined();
    expect(getDescriptionTimelog("---\ntimelog:\n---")).toBeUndefined();
    expect(getDescriptionTimelog("No block")).toBeUndefined();
    expect(getDescriptionTimelog(undefined)).toBeUndefined();
  });

  it("does not list the timelog among the fields", () => {
    expect(
      splitDescription("---\ntimelog:\n  project: Acme\n---").frontmatter
        ?.fields,
    ).toEqual([]);
  });
});

describe("isSameTimelog", () => {
  it("compares project and task names, ignoring case", () => {
    expect(
      isSameTimelog(
        { project: "Acme", task: "Design" },
        { project: "acme", task: "DESIGN" },
      ),
    ).toBe(true);
    expect(
      isSameTimelog({ project: "Acme" }, { project: "Acme", task: "Design" }),
    ).toBe(false);
    expect(isSameTimelog(undefined, undefined)).toBe(true);
    expect(isSameTimelog(undefined, { project: "Acme" })).toBe(false);
  });
});

describe("isFrontmatterLink", () => {
  it("accepts http and https addresses only", () => {
    expect(isFrontmatterLink("https://acme.teamwork.com/app/tasks/1")).toBe(
      true,
    );
    expect(isFrontmatterLink("HTTP://example.com")).toBe(true);
    expect(isFrontmatterLink("javascript:alert(1)")).toBe(false);
    expect(isFrontmatterLink("file:///etc/passwd")).toBe(false);
    expect(isFrontmatterLink("https://example.com and more")).toBe(false);
    expect(isFrontmatterLink("acme.teamwork.com")).toBe(false);
  });
});
