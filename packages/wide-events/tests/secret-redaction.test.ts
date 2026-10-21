import { describe, expect, it } from "vitest";
import {
  ConnectionRedaction,
  redactSecretValues,
} from "../secret-redaction.ts";

// Moved with the redaction from apps/api/src/plugin-errors.test.ts. The
// secrets are the values connectionSecretValues gave those tests. The
// summary and the request budget belong to the local API, and so do their
// tests.

describe("redacting in one pass on the original message", () => {
  it("finds a cut secret's start even when a shorter secret sits inside it", () => {
    expect(redactSecretValues("Failed ABCD…", ["ABCDEF", "CD"])).toBe(
      "Failed [secret]…",
    );
    expect(
      redactSecretValues("token pat-7c1e9a…", ["pat-7c1e9a2b4d6f8a0c", "7c1e"]),
    ).toBe("token [secret]…");
  });

  it("replaces overlapping secrets as one", () => {
    expect(redactSecretValues("abc123xyz9", ["abc123", "123xyz9"])).toBe(
      "[secret]",
    );
    expect(redactSecretValues("abc123xyz…", ["abc123", "123xyz9"])).toBe(
      "[secret]…",
    );
  });

  it("leaves the [secret] marks already in a message alone", () => {
    expect(redactSecretValues("Bad [secret]", ["secret"])).toBe("Bad [secret]");
    expect(redactSecretValues("Bad [secret]", ["e"])).toBe("Bad [secret]");
  });

  it("redacts large adversarial messages quickly", () => {
    const started = performance.now();
    // 25,000 marks, each with a one-character secret beside it.
    expect(redactSecretValues("[secret]1".repeat(25_000), ["1"])).toBe(
      "[secret]".repeat(50_000),
    );
    // Every match crosses two marks, so every match widens.
    expect(redactSecretValues("[secret]1".repeat(25_000), ["]1["])).toBe(
      "[secret]1",
    );
    // Twice as long is past one text's budget, so it is hidden whole.
    expect(redactSecretValues("[secret]1".repeat(50_000), ["1"])).toBe(
      "Hidden because it couldn't be checked for secrets.",
    );
    // A long secret whose every start almost matches the end of a cut message.
    expect(
      redactSecretValues(`${"a".repeat(4_094)}c…`, [`${"a".repeat(3_999)}b`]),
    ).toBe(`${"a".repeat(4_094)}c…`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("the redaction's work budget", () => {
  const UNCHECKED = "Hidden because it couldn't be checked for secrets.";
  const undeclared = (values: string[]) => values;
  // 1,000 undeclared values, "a" to "a".repeat(1000).
  const growingSecrets = undeclared(
    Array.from({ length: 1_000 }, (_, index) => "a".repeat(index + 1)),
  );
  // 20 undeclared values of "a".repeat(3990) and an id.
  const longSecrets = undeclared(
    Array.from({ length: 20 }, (_, index) => `${"a".repeat(3_990)}${index}`),
  );

  it("hides a text it can't check behind a fixed message", () => {
    expect(
      new ConnectionRedaction(growingSecrets).text("a".repeat(1_000)),
    ).toBe(UNCHECKED);
    expect(redactSecretValues("a".repeat(1_000), growingSecrets)).toBe(
      UNCHECKED,
    );
  });

  it("finds the start of a cut secret in time linear in the secret", () => {
    const started = performance.now();
    for (let round = 0; round < 50; round += 1) {
      expect(redactSecretValues(`${"a".repeat(998)}b…`, longSecrets)).toBe(
        `${"a".repeat(998)}b…`,
      );
    }
    expect(redactSecretValues(`x ${"a".repeat(997)}…`, longSecrets)).toBe(
      "x [secret]…",
    );
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("hides a text past its own budget, and goes on with the next", () => {
    const redaction = new ConnectionRedaction(["s3cret"]);

    expect(redaction.text("x".repeat(300_000))).toBe(UNCHECKED);
    expect(redaction.text("Bad s3cret.")).toBe("Bad [secret].");
  });
});
