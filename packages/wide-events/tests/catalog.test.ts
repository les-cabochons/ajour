import { describe, expect, it } from "vitest";
import {
  catalog,
  defineCatalog,
  envelopeFields,
  operational,
  sensitive,
  type FieldTree,
} from "../catalog.ts";

/** Every leaf of a field tree, with its path. */
function leaves(tree: FieldTree, path: string[] = []): [string, unknown][] {
  return Object.entries(tree).flatMap(([key, node]) =>
    "privacy" in node && typeof node.privacy === "string"
      ? [[[...path, key].join("."), node.privacy] as [string, unknown]]
      : leaves(node as FieldTree, [...path, key]),
  );
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

    defineCatalog({
      counters: {},
      events: {
        "time_entry.stop": {
          kinds: ["command"],
          // @ts-expect-error A field must declare operational or sensitive.
          fields: { time_entry: { id: "string" } },
        },
      },
    });
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
    defineCatalog({
      // @ts-expect-error A counter must declare its class too.
      counters: { store_write_count: 1 },
      events: {},
    });
  });
});
