import { describe, expect, it } from "vitest";
import { catalog, envelopeFields, type FieldTree } from "../catalog.ts";
import { createPrivacyFilter } from "../sinks.ts";

type Leaf = { path: string[]; privacy: string; shape?: string };

/** Every classed leaf of a field tree, read from the catalog itself. */
function leaves(tree: FieldTree, path: string[] = []): Leaf[] {
  return Object.entries(tree).flatMap(([key, node]) =>
    "privacy" in node && typeof node.privacy === "string"
      ? [
          {
            path: [...path, key],
            privacy: node.privacy,
            shape: "shape" in node ? String(node.shape) : undefined,
          },
        ]
      : leaves(node as FieldTree, [...path, key]),
  );
}

/** An event of `name` with every field its entry and the envelope declare, each set. */
function fullEvent(name: string, fields: Leaf[]) {
  const event: Record<string, unknown> = {};
  for (const { path, shape } of fields) {
    let target = event;
    for (const key of path.slice(0, -1)) {
      target = (target[key] ??= {}) as Record<string, unknown>;
    }
    target[path.at(-1)!] =
      shape === "strings"
        ? [`value of ${path.join(".")}`]
        : shape === "numbers"
          ? { a: 1 }
          : shape === "step_failures"
            ? [{ name: "step", outcome: "error", error_type: "Error" }]
            : `value of ${path.join(".")}`;
  }
  event.name = name;
  return event as never;
}

/** The leaf paths an event holds: a field with a shape is one leaf, whatever it holds. */
function pathsOf(
  value: unknown,
  shaped: ReadonlySet<string>,
  path: string[] = [],
): string[] {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    shaped.has(path.join("."))
  ) {
    return [path.join(".")];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    pathsOf(child, shaped, [...path, key]),
  );
}

const filter = createPrivacyFilter(catalog);
const envelope = leaves(envelopeFields as unknown as FieldTree);

describe("the privacy filter", () => {
  const entries = Object.entries(catalog.events).map(([name, spec]) => {
    const fields = [...leaves(spec.fields), ...envelope];
    return { name, fields, event: fullEvent(name, fields) };
  });

  it("finds sensitive fields to drop: nested time record fields and error.message", () => {
    const sensitive = entries.flatMap(({ name, fields }) =>
      fields
        .filter(({ privacy }) => privacy === "sensitive")
        .map(({ path }) => `${name} ${path.join(".")}`),
    );
    expect(sensitive).toEqual(
      expect.arrayContaining([
        "time_entry.create time_entry.day",
        "time_entry.update time_entry.duration_after_ms",
        "week.submit week.week_of",
        "app.error error.message",
      ]),
    );
  });

  it.each([
    { includeSensitive: false, keeps: ["operational"] },
    { includeSensitive: true, keeps: ["operational", "sensitive"] },
  ])(
    "keeps every field of every event whose class is allowed (sensitive allowed: $includeSensitive)",
    ({ includeSensitive, keeps }) => {
      for (const { name, fields, event } of entries) {
        const expected = fields
          .filter(({ privacy }) => keeps.includes(privacy))
          .map(({ path }) => path.join("."));
        expect([
          name,
          pathsOf(
            filter(event, { includeSensitive }),
            new Set(
              fields
                .filter(({ shape }) => shape)
                .map(({ path }) => path.join(".")),
            ),
          ).sort(),
        ]).toEqual([name, [...new Set(expected)].sort()]);
      }
    },
  );

  it("drops a field the catalog doesn't declare, with sensitive fields allowed or not", () => {
    const event = {
      name: "time_entry.update",
      outcome: "ok",
      note: "CANARY",
      time_entry: { id: "entry-1", title: "CANARY", duration_after_ms: 60_000 },
      error: { type: "Error", message: "failed", stack: "CANARY" },
    } as never;

    for (const includeSensitive of [false, true]) {
      expect(JSON.stringify(filter(event, { includeSensitive }))).not.toContain(
        "CANARY",
      );
    }
    expect(filter(event, { includeSensitive: false })).toEqual({
      name: "time_entry.update",
      outcome: "ok",
      time_entry: { id: "entry-1" },
      error: { type: "Error" },
    });
  });

  it("keeps only the envelope of an event the catalog doesn't name, and never changes the event", () => {
    const event = {
      name: "made.up",
      outcome: "ok",
      secret: { value: "CANARY" },
    } as never;
    const before = structuredClone(event);

    expect(filter(event, { includeSensitive: true })).toEqual({
      name: "made.up",
      outcome: "ok",
    });
    expect(event).toEqual(before);
  });

  it("reads only the catalog's own keys, never what an object inherits", () => {
    const event = JSON.parse(
      '{"name":"time_entry.update","constructor":{"x":1},"__proto__":{"y":2},"toString":"z"}',
    );

    expect(filter(event, { includeSensitive: true })).toEqual({
      name: "time_entry.update",
    });
  });
});

describe("what the privacy filter lets a declared field hold", () => {
  const withSensitive = { includeSensitive: true };
  const run = (event: Record<string, unknown>) =>
    filter({ name: "time_entry.update", ...event } as never, withSensitive);

  it.each([
    { field: "error.type", event: { error: { type: { secret: "LEAK" } } } },
    {
      field: "step_failures",
      event: { step_failures: [{ message: "LEAK" }] },
    },
    { field: "counts", event: { counts: { a: "LEAK" } } },
    {
      field: "logs.state",
      event: { name: "logs.status", logs: { state: { nested: "LEAK" } } },
    },
    { field: "steps", event: { steps: [{ secret: "LEAK" }, "ok"] } },
    { field: "steps as an object", event: { steps: { a: "LEAK" } } },
    { field: "error as a string", event: { error: "LEAK" } },
    {
      field: "a domain field's list",
      event: { time_entry: { id: ["a", { secret: "LEAK" }] } },
    },
    {
      field: "a function",
      event: { time_entry: { id: () => "LEAK" } },
    },
  ])(
    "drops $field when it holds an object where a value belongs",
    ({ event }) => {
      for (const includeSensitive of [false, true]) {
        const kept = filter({ name: "time_entry.update", ...event } as never, {
          includeSensitive,
        });
        expect(JSON.stringify(kept)).not.toContain("LEAK");
        expect(JSON.stringify(kept)).not.toContain("secret");
      }
    },
  );

  it("keeps a step failure's own keys and primitives, and nothing else", () => {
    expect(
      run({
        step_failures: [
          {
            name: "calendar.sync",
            outcome: "error",
            error_type: "TypeError",
            message: "LEAK",
            error_code: { deep: "LEAK" },
          },
          "LEAK",
          { message: "LEAK" },
        ],
      }),
    ).toEqual({
      name: "time_entry.update",
      step_failures: [
        { name: "calendar.sync", outcome: "error", error_type: "TypeError" },
      ],
    });
  });

  it("keeps counts that are numbers, steps that are strings, and an error's primitives", () => {
    expect(
      run({
        counts: { store_write_count: 2, bad: "LEAK", nested: { a: 1 } },
        steps: ["a", "b"],
        error: {
          type: "Error",
          code: "E1",
          message: "failed",
          retriable: false,
          stack: "LEAK",
        },
      }),
    ).toEqual({
      name: "time_entry.update",
      counts: { store_write_count: 2 },
      steps: ["a", "b"],
      error: { type: "Error", code: "E1", message: "failed", retriable: false },
    });
  });

  it("counts what it leaves out through onDrop", () => {
    let dropped = 0;
    filter(
      {
        name: "time_entry.update",
        counts: { a: "LEAK" },
        note: "LEAK",
        steps: [1],
      } as never,
      {
        includeSensitive: true,
        onDrop: () => {
          dropped += 1;
        },
      },
    );
    expect(dropped).toBe(3);
  });
});
