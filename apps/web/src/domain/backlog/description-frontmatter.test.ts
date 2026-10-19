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
            kind: "value",
            key: "Teamwork",
            value: "https://acme.teamwork.com/app/tasks/123",
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
      frontmatter: { fields: [{ kind: "value", key: "Owner", value: "Ada" }] },
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
      { kind: "value", key: "Quoted", value: "a: b # not a comment" },
      { kind: "value", key: "Single", value: "it's" },
      {
        kind: "value",
        key: "Link",
        value: "https://acme.teamwork.com/#/tasks/1",
      },
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
      {
        kind: "list",
        key: "Links",
        values: ["https://one.example", "https://two.example"],
      },
      { kind: "list", key: "Tags", values: ["alpha", "beta, gamma"] },
      { kind: "list", key: "Owners", values: ["Ada"] },
    ]);
  });

  it("keeps nested fields under their parent and skips empty values", () => {
    const split = splitDescription(
      [
        "---",
        "Client:",
        "  Name: Acme",
        "  Contact:",
        "    Email: ada@acme.test",
        "Empty:",
        "Blank:",
        "  Inside:",
        "None: []",
        "---",
      ].join("\n"),
    );

    expect(split.frontmatter?.fields).toEqual([
      {
        kind: "map",
        key: "Client",
        fields: [
          { kind: "value", key: "Name", value: "Acme" },
          {
            kind: "map",
            key: "Contact",
            fields: [{ kind: "value", key: "Email", value: "ada@acme.test" }],
          },
        ],
      },
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

  it("reads a key whose value is only a comment as opening its children", () => {
    expect(
      getDescriptionTimelog(
        "---\ntimelog: # where the time goes\n  project: Acme\n---",
      ),
    ).toEqual({ project: "Acme" });
    expect(
      splitDescription("---\nLinks: # the links\n  - https://one.example\n---")
        .frontmatter?.fields,
    ).toEqual([
      { kind: "list", key: "Links", values: ["https://one.example"] },
    ]);
    expect(
      splitDescription("---\nLinks:\n  - # later\n  - https://two.example\n---")
        .frontmatter?.fields,
    ).toEqual([
      { kind: "list", key: "Links", values: ["https://two.example"] },
    ]);
  });

  it("is not frontmatter when a plain value is not valid YAML or uses an unsupported construct", () => {
    for (const value of [
      "Ada: Lovelace",
      "*missing",
      "&anchor Ada",
      "!tag Ada",
      "|",
      ">",
      "%x",
      "@x",
      "`x`",
      "{ a: b }",
    ]) {
      expect(
        splitDescription(`---\nOwner: ${value}\n---\nText`).frontmatter,
      ).toBeNull();
    }
  });

  it("is not frontmatter when a map repeats a key, ignoring case", () => {
    expect(
      getDescriptionTimelog(
        "---\ntimelog:\n  project: Alpha\n  project: Beta\n---",
      ),
    ).toBeUndefined();
    expect(
      splitDescription("---\nOwner: Ada\nowner: Grace\n---\nText").frontmatter,
    ).toBeNull();
    expect(
      splitDescription("---\ntimelog:\n  project: A\nTimelog:\n  task: B\n---")
        .frontmatter,
    ).toBeNull();
  });

  it("keeps escaped quotes and commas inside quoted items of an inline list", () => {
    expect(
      splitDescription(`---\nLabels: ["a\\"b", 'it''s, ok', next]\n---`)
        .frontmatter?.fields,
    ).toEqual([
      { kind: "list", key: "Labels", values: ['a"b', "it's, ok", "next"] },
    ]);
  });

  it("is not frontmatter when a comment cuts an inline list short", () => {
    const description = [
      "---",
      "Owners: [Ada # include Grace, Grace]",
      "timelog:",
      "  project: Acme",
      "---",
      "Text",
    ].join("\n");
    expect(splitDescription(description)).toEqual({
      frontmatter: null,
      body: description,
    });
    expect(getDescriptionTimelog(description)).toBeUndefined();
    expect(
      splitDescription("---\nOwners: [Ada, Grace] # both\n---").frontmatter
        ?.fields,
    ).toEqual([{ kind: "list", key: "Owners", values: ["Ada", "Grace"] }]);
  });

  it("is not frontmatter when an inline list has an empty entry or a stray brace", () => {
    for (const list of [
      "[Ada,, Grace]",
      "[, Ada]",
      "[,]",
      "[Ada,,]",
      "[Ada, Grace}]",
    ]) {
      expect(
        getDescriptionTimelog(
          `---\nOwners: ${list}\ntimelog:\n  project: Acme\n---`,
        ),
      ).toBeUndefined();
    }
  });

  it("allows one trailing comma and an empty inline list", () => {
    expect(
      splitDescription("---\nOwners: [Ada, Grace,]\nNone: []\n---").frontmatter
        ?.fields,
    ).toEqual([{ kind: "list", key: "Owners", values: ["Ada", "Grace"] }]);
  });

  it("treats only spaces and tabs as YAML whitespace", () => {
    // A non-breaking space neither indents nor trims: ` project` is a
    // second root key, and `timelog ` is not the timelog.
    expect(
      getDescriptionTimelog("---\ntimelog:\n project: Acme\n---"),
    ).toBeUndefined();
    expect(
      getDescriptionTimelog("---\ntimelog :\n  project: Acme\n---"),
    ).toBeUndefined();
  });

  it("is not frontmatter with a bare carriage return or a character YAML forbids", () => {
    for (const block of [
      "Owner: a\rb",
      "Owner: 'a\rb'",
      "Owner: Ada\u0000",
      "# note \u0001\nOwner: Ada",
      'Owner: "Ada\u0007"',
    ]) {
      expect(
        splitDescription(`---\n${block}\n---\nText`).frontmatter,
      ).toBeNull();
    }
    // An escape spells a control character without writing it raw.
    expect(
      splitDescription('---\nOwner: "Ada\\x07"\n---').frontmatter?.fields,
    ).toEqual([{ kind: "value", key: "Owner", value: "Ada\u0007" }]);
  });

  it("is not frontmatter when a key runs past YAML's 1,024 characters", () => {
    const key = (length: number) => "a".repeat(length);
    expect(
      splitDescription(`---\n${key(1024)}: Ada\n---`).frontmatter,
    ).not.toBeNull();
    expect(
      splitDescription(`---\n${key(1025)}: Ada\n---`).frontmatter,
    ).toBeNull();
    expect(
      splitDescription(`---\n"${key(1023)}": Ada\n---`).frontmatter,
    ).toBeNull();
  });

  it("is not frontmatter with a YAML null, which is not text", () => {
    for (const value of ["null", "Null", "NULL", "~", "[007, null]", "[~]"]) {
      expect(
        splitDescription(`---\nOwner: ${value}\n---\nText`).frontmatter,
      ).toBeNull();
    }
    expect(
      splitDescription('---\nOwner: "null"\nCode: 007\n---').frontmatter
        ?.fields,
    ).toEqual([
      { kind: "value", key: "Owner", value: "null" },
      { kind: "value", key: "Code", value: "007" },
    ]);
  });

  it("is not frontmatter when a comment hides a key's colon", () => {
    const description = [
      "---",
      "Owner # note: Ada",
      "timelog:",
      "  project: Acme",
      "---",
      "Body",
    ].join("\n");
    expect(splitDescription(description)).toEqual({
      frontmatter: null,
      body: description,
    });
    expect(getDescriptionTimelog(description)).toBeUndefined();
    expect(
      splitDescription("---\nOwner#1: Ada\n---").frontmatter?.fields,
    ).toEqual([{ kind: "value", key: "Owner#1", value: "Ada" }]);
  });

  it("is not frontmatter when a key starts with a YAML indicator", () => {
    for (const line of ["? Owner: Ada", ",Owner: Ada", "- Owner: Ada"]) {
      expect(splitDescription(`---\n${line}\n---`).frontmatter).toBeNull();
    }
  });

  it("reads quotes inside a plain inline-list item as text", () => {
    expect(
      splitDescription(
        `---\nLabels: [Bob's, Jane's]\nMore: [don't, say "hi"]\n---`,
      ).frontmatter?.fields,
    ).toEqual([
      { kind: "list", key: "Labels", values: ["Bob's", "Jane's"] },
      { kind: "list", key: "More", values: ["don't", 'say "hi"'] },
    ]);
  });

  it("keeps plain values with colons that are not followed by a space", () => {
    expect(
      splitDescription("---\nStart: 10:30\nLink: https://example.com/a:b\n---")
        .frontmatter?.fields,
    ).toEqual([
      { kind: "value", key: "Start", value: "10:30" },
      { kind: "value", key: "Link", value: "https://example.com/a:b" },
    ]);
  });

  it("decodes double-quoted escapes and rejects unknown ones", () => {
    expect(
      getDescriptionTimelog(
        '---\ntimelog:\n  project: "\\u0041cme \\x42\\t\\"C\\" \\\\"\n---',
      ),
    ).toEqual({ project: 'Acme B\t"C" \\' });
    expect(
      splitDescription('---\nOwner: "\\q"\n---\nText').frontmatter,
    ).toBeNull();
    expect(
      splitDescription('---\nOwner: "\\u00G1"\n---\nText').frontmatter,
    ).toBeNull();
  });

  it("is not frontmatter when keys nest deeper than Ajour reads, without throwing", () => {
    const deep = (levels: number) =>
      [
        "---",
        ...Array.from(
          { length: levels },
          (_, level) => `${" ".repeat(level)}k${level}:`,
        ),
        `${" ".repeat(levels)}last: value`,
        "---",
        "Text",
      ].join("\n");

    expect(splitDescription(deep(5)).frontmatter).not.toBeNull();
    expect(() => splitDescription(deep(5000))).not.toThrow();
    expect(splitDescription(deep(5000))).toEqual({
      frontmatter: null,
      body: deep(5000),
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
