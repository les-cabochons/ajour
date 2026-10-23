import { describe, expect, it } from "vitest";
import {
  catalog,
  defineCatalog,
  envelopeFields,
  operational,
  sensitive,
  type FieldTree,
} from "../catalog.ts";

/**
 * Every leaf of a field tree, with its path and class. A node that is
 * neither a field nor an object with fields is a leaf with no class.
 */
function leaves(tree: FieldTree, path: string[] = []): [string, unknown][] {
  return Object.entries(tree).flatMap(([key, node]) => {
    const at = [...path, key];
    if ("privacy" in node && typeof node.privacy === "string") {
      return [[at.join("."), node.privacy] as [string, unknown]];
    }
    const children = leaves(node as FieldTree, at);
    return children.length > 0 ? children : [[at.join("."), undefined]];
  });
}

describe("the catalog", () => {
  it("gives every field of every event a privacy class", () => {
    const classes = Object.entries(catalog.events).flatMap(([name, spec]) =>
      leaves(spec.fields).map(([path, privacy]) => [
        `${name} ${path}`,
        privacy,
      ]),
    );

    expect(classes.length).toBeGreaterThan(0);
    for (const [field, privacy] of classes) {
      expect([field, privacy]).toEqual([
        field,
        expect.stringMatching(/^(operational|sensitive)$/),
      ]);
    }
  });

  it("names every event <subject>.<operation> in snake_case", () => {
    for (const name of Object.keys(catalog.events)) {
      expect(name).toMatch(/^[a-z]+(?:_[a-z]+)*\.[a-z]+(?:_[a-z]+)*$/);
    }
  });

  it("classes the days, weeks and durations of time records sensitive", () => {
    const timeRecordFields = Object.entries(catalog.events).flatMap(
      ([name, spec]) =>
        leaves(spec.fields)
          .filter(([path]) =>
            /(^|\.)(day|from_day|to_day|week_of|duration_ms|duration_before_ms|duration_after_ms|counted_ms|days_covered)$/.test(
              path,
            ),
          )
          .map(([path, privacy]) => [`${name} ${path}`, privacy]),
    );

    expect(timeRecordFields).toContainEqual([
      "time_entry.create time_entry.day",
      "sensitive",
    ]);
    expect(timeRecordFields).toContainEqual([
      "week.submit week.week_of",
      "sensitive",
    ]);
    for (const [field, privacy] of timeRecordFields) {
      expect([field, privacy]).toEqual([field, "sensitive"]);
    }
  });

  it("names a store command's write counts once, for every command to add to", () => {
    expect(catalog.counters.store_write_count.privacy).toBe("operational");
    expect(catalog.counters.store_write_bytes.privacy).toBe("operational");
    expect(catalog.events["time_entry.start"].kinds).toContain("command");
    expect(catalog.events["time_entry.start"].reasons).toEqual(
      expect.arrayContaining(["locked_week", "stale_window"]),
    );
  });

  it("classes the envelope too: an error message is sensitive, its type is not", () => {
    expect(envelopeFields.error.message.privacy).toBe("sensitive");
    expect(envelopeFields.error.type.privacy).toBe("operational");
    expect(envelopeFields.duration_ms.privacy).toBe("operational");
    expect(
      leaves(envelopeFields).filter(([, privacy]) => privacy === "sensitive"),
    ).toEqual([["error.message", "sensitive"]]);
  });

  it("refuses at compile time a field without a class, or one named like an envelope field", () => {
    const valid = defineCatalog({
      counters: { store_write_count: operational<number>() },
      events: {
        "time_entry.stop": {
          kinds: ["command"],
          fields: {
            time_entry: { id: operational(), duration_ms: sensitive<number>() },
          },
        },
      },
    });
    expect(
      valid.events["time_entry.stop"].fields.time_entry.duration_ms,
    ).toEqual({ privacy: "sensitive" });

    expect(() =>
      defineCatalog({
        counters: {},
        events: {
          "time_entry.stop": {
            kinds: ["command"],
            // @ts-expect-error A field must declare operational or sensitive.
            fields: { time_entry: { id: "string" } },
          },
        },
      }),
    ).toThrow("declares no privacy class");
    defineCatalog({
      counters: {},
      events: {
        "time_entry.stop": {
          kinds: ["command"],
          // @ts-expect-error `outcome` belongs to the envelope.
          fields: { outcome: operational() },
        },
      },
    });
    expect(() =>
      defineCatalog({
        // @ts-expect-error A counter must declare its class too.
        counters: { store_write_count: 1 },
        events: {},
      }),
    ).toThrow('Catalog field "counter store_write_count"');
  });

  it("refuses an empty object where a field belongs, at compile time and at load", () => {
    expect(() =>
      defineCatalog({
        counters: {},
        events: {
          "time_entry.stop": {
            kinds: ["command"],
            // @ts-expect-error An empty object declares no class.
            fields: { time_entry: { id: {} } },
          },
        },
      }),
    ).toThrow(
      'Catalog field "time_entry.stop time_entry.id" declares no privacy class.',
    );
    expect(leaves({ time_entry: { id: {} } } as unknown as FieldTree)).toEqual([
      ["time_entry.id", undefined],
    ]);
  });

  it("keeps what the renderer and the other runtimes each declare for one event", () => {
    const names = [
      "project.import",
      "team.create",
      "connection.delete",
    ] as const;
    for (const name of names) {
      const spec = catalog.events[name];
      expect(spec.kinds).toContain("command");
      expect(spec.reasons).toEqual(
        expect.arrayContaining(["locked_week", "stale_window"]),
      );
      expect(spec.fields).toHaveProperty("store");
      expect(spec.fields).toHaveProperty("http");
    }
    expect(
      Object.keys(
        catalog.events["backlog_import.commit"].fields.backlog_import,
      ),
    ).toEqual(expect.arrayContaining(["candidate_count", "committed_count"]));
    expect(catalog.events["app.error"].fields.crash).toHaveProperty(
      "handled_by",
    );
    expect(catalog.events["app.error"].fields.crash).not.toHaveProperty(
      "handled_by_toast",
    );
  });
});
