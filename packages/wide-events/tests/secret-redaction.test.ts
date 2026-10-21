import { describe, expect, it } from "vitest";
import {
  ConnectionRedaction,
  redactConnectionSummary,
  redactPluginText,
  redactSecretValues,
} from "../secret-redaction.ts";

// Moved with the redaction from apps/api/src/plugin-errors.test.ts. The
// secrets are the values connectionSecretValues gave those tests.

describe("redacting a connection summary", () => {
  const summarySecrets = ["pat-abc", "482913"];

  it("redacts a connection summary and keeps values without a secret as they are", () => {
    expect(
      redactConnectionSummary(
        {
          site: "https://acme.example",
          auth: "Bearer pat-abc",
          pin: 482913,
          projects: 3,
          verified: true,
        },
        summarySecrets,
      ),
    ).toEqual({
      site: "https://acme.example",
      auth: "Bearer [secret]",
      pin: "[secret]",
      projects: 3,
      verified: true,
    });
  });

  it("drops a summary entry whose key holds a secret, so no two keys collide", () => {
    expect(
      redactConnectionSummary(
        {
          "pat-abc": "Connected",
          "Signed in with pat-abc": "yes",
          site: "https://acme.example",
        },
        summarySecrets,
      ),
    ).toEqual({ site: "https://acme.example" });
  });

  it("drops a summary of more than 50 entries, and keeps one no secret can be in, quickly", () => {
    const manySecrets = Array.from(
      { length: 20_000 },
      (_, index) => `old-value-${index}`,
    );
    const summaryOf = (entries: number) =>
      Object.fromEntries(
        Array.from({ length: entries }, (_, index) => [
          `key${index}`,
          `value ${index}`,
        ]),
      );

    const started = performance.now();
    expect(redactConnectionSummary(summaryOf(20_000), summarySecrets)).toEqual(
      {},
    );
    expect(redactConnectionSummary(summaryOf(50), summarySecrets)).toEqual(
      summaryOf(50),
    );
    // Every secret is longer than every entry, so none can match one.
    expect(redactConnectionSummary(summaryOf(50), manySecrets)).toEqual(
      summaryOf(50),
    );
    expect(performance.now() - started).toBeLessThan(200);
  });
});

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
  const summaryOf = (value: string) =>
    Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [`key${index}`, value]),
    );
  // 1,000 undeclared values, "a" to "a".repeat(1000).
  const growingSecrets = undeclared(
    Array.from({ length: 1_000 }, (_, index) => "a".repeat(index + 1)),
  );
  // 20 undeclared values of "a".repeat(3990) and an id.
  const longSecrets = undeclared(
    Array.from({ length: 20 }, (_, index) => `${"a".repeat(3_990)}${index}`),
  );

  it("drops a summary too costly to check, and keeps one quickly checked", () => {
    const started = performance.now();
    expect(
      redactConnectionSummary(summaryOf("a".repeat(1_000)), growingSecrets),
    ).toEqual({});
    expect(performance.now() - started).toBeLessThan(200);

    // Every secret is longer than every value, so only the cut rule reads
    // them, and none starts where a value is cut.
    const restarted = performance.now();
    expect(
      redactConnectionSummary(summaryOf(`${"a".repeat(998)}b…`), longSecrets),
    ).toEqual(summaryOf(`${"a".repeat(998)}b…`));
    expect(performance.now() - restarted).toBeLessThan(200);
  });

  it("hides a text it can't check behind a fixed message", () => {
    expect(redactPluginText("a".repeat(1_000), growingSecrets)).toBe(UNCHECKED);
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
});

describe("one redaction per connection and request", () => {
  const UNCHECKED = "Hidden because it couldn't be checked for secrets.";
  // A short token, and `count` undeclared values of 4,000 characters.
  const secretsWith = (count: number) => [
    "key-7",
    ...Array.from(
      { length: count },
      (_, index) => `${"k".repeat(3_990)}${index}`,
    ),
  ];
  const messages = Array.from({ length: 20_000 }, (_, index) =>
    index === 7 ? "PATCH failed with key-7." : "Estimate rejected.",
  );

  it.each([20, 240])(
    "redacts 20,000 field messages against %i long secrets quickly, as one call per message would",
    (count) => {
      const secrets = secretsWith(count);
      const redaction = new ConnectionRedaction(secrets);

      const started = performance.now();
      const redacted = messages.map((message) => redaction.text(message));
      expect(performance.now() - started).toBeLessThan(500);

      expect(redacted[7]).toBe("PATCH failed with [secret].");
      expect(redacted).toEqual(
        messages.map((message) => redactPluginText(message, secrets)),
      );
    },
  );

  it("hides a text past its own budget, and goes on with the next", () => {
    const redaction = new ConnectionRedaction(["s3cret"]);

    expect(redaction.text("x".repeat(300_000))).toBe(UNCHECKED);
    expect(redaction.text("Bad s3cret.")).toBe("Bad [secret].");
  });

  it("stays quick when 20,000 stored values meet 20,000 cut messages", () => {
    const started = performance.now();
    const redaction = new ConnectionRedaction(
      Array.from(
        { length: 20_000 },
        (_, index) => `stored-value-${index}-abcdefgh`,
      ),
    );
    const results = Array.from({ length: 20_000 }, () =>
      redaction.text("Estimate rejected…"),
    );

    expect(performance.now() - started).toBeLessThan(300);
    // Each needs the cut rule against all 20,000, past its own budget.
    expect(results.every((result) => result === UNCHECKED)).toBe(true);
  });

  it("stays quick when 100,000 short secrets meet 100,000 messages", () => {
    const started = performance.now();
    const redaction = new ConnectionRedaction(
      Array.from(
        { length: 100_000 },
        (_, index) => `s${index.toString(36).padStart(5, "0")}`,
      ),
    );
    const results = Array.from({ length: 100_000 }, () =>
      redaction.text("Estimate rejected."),
    );

    expect(performance.now() - started).toBeLessThan(300);
    // Every secret could be in each message, past its own budget.
    expect(results.every((result) => result === UNCHECKED)).toBe(true);
  });

  it("hides the rest once the request's budget is spent, but not a text no secret can be in", () => {
    const redaction = new ConnectionRedaction(["s3cret"]);
    const big = `${"x".repeat(199_993)}s3cret!`;

    const results = Array.from({ length: 40 }, () => redaction.text(big));

    expect(results[0]).toBe(`${"x".repeat(999)}…`);
    expect(results.at(-1)).toBe(UNCHECKED);
    expect(redaction.text("Bad s3cret.")).toBe(UNCHECKED);
    // Shorter than the secret and not cut, so no secret can be in it.
    expect(redaction.text("Bad")).toBe("Bad");
  });
});
