import { describe, expect, it } from "vitest";
import {
  connectionRedaction,
  connectionlessPluginErrorMessage,
  redactPluginText,
} from "./plugin-errors.ts";
import {
  connectionCredentials,
  connectionSecretValues,
} from "./connection-credentials.ts";

/**
 * The ceiling for every "quickly" below. Each guards against unbounded work,
 * such as checking every secret against every message, which would be
 * billions of steps and take seconds to minutes. The bounded runs take
 * hundreds of milliseconds or less, but shared CI machines and a busy laptop
 * run several times slower, so a tighter ceiling fails at random.
 */
const QUICK_MS = 2_000;

// The redaction of one text, and its tests, live in packages/wide-events.
// The summary and the request budget are the local API's.

const plugin = {
  connectionFields: [
    { id: "siteUrl", secret: false },
    { id: "token", secret: true },
    { id: "pin", secret: true },
    { id: "teamSecret", secret: true },
  ],
};

const pluginErrorMessage = (
  error: unknown,
  ...rest: Parameters<typeof connectionCredentials>
) => connectionCredentials(...rest).errorMessage(error);

const redactConnectionSummary = (
  summary: Record<string, string | number | boolean>,
  secrets: readonly string[],
) => connectionRedaction(secrets).summary(summary);

describe("plugin error messages", () => {
  it("replaces a numeric secret, and a boolean one a field declares secret", () => {
    expect(
      pluginErrorMessage(
        new Error("PIN 482913 was refused by https://acme.example."),
        plugin,
        { siteUrl: "https://acme.example", pin: 482913 },
      ),
    ).toBe("PIN [secret] was refused by https://acme.example.");
    expect(
      pluginErrorMessage(new Error("Team secret is true."), plugin, {
        teamSecret: true,
      }),
    ).toBe("Team secret is [secret].");
  });

  it("replaces a secret that holds another secret whole", () => {
    expect(
      pluginErrorMessage(
        new Error("Tried s3cret-and-more, then s3cret."),
        plugin,
        { token: "s3cret-and-more", teamSecret: "s3cret" },
      ),
    ).toBe("Tried [secret], then [secret].");
  });

  it("skips an empty secret instead of replacing between every character", () => {
    expect(
      pluginErrorMessage(new Error("No token, PIN 482913."), plugin, {
        token: "",
        pin: 482913,
      }),
    ).toBe("No token, PIN [secret].");
  });

  it("redacts every config it is given, such as the submitted and the stored one", () => {
    expect(
      pluginErrorMessage(
        new Error("Neither new-token nor old-token works."),
        plugin,
        { token: "new-token" },
        { token: "old-token" },
      ),
    ).toBe("Neither [secret] nor [secret] works.");
  });

  it("bounds the message to 1,000 characters with an ellipsis", () => {
    const message = pluginErrorMessage(new Error("x".repeat(1_500)), plugin);
    expect(message).toBe(`${"x".repeat(999)}…`);
  });

  it("bounds after redacting, so a secret near the end can't be cut in half", () => {
    // 990 + 1 + 20 characters before redaction, 999 after.
    expect(
      pluginErrorMessage(
        new Error(`${"x".repeat(990)} pat-7c1e9a2b4d6f8a0c`),
        plugin,
        { token: "pat-7c1e9a2b4d6f8a0c" },
      ),
    ).toBe(`${"x".repeat(990)} [secret]`);
  });

  it("replaces the start of a secret that the worker's cut left before its ellipsis", () => {
    expect(
      pluginErrorMessage(new Error("Failed with token pat-7c1e…"), plugin, {
        token: "pat-7c1e9a2b4d6f8a0c",
      }),
    ).toBe("Failed with token [secret]…");
  });

  it("replaces a secret with spaces at its ends after the host trims the message", () => {
    expect(
      pluginErrorMessage(new Error("pat-abc failed"), plugin, {
        token: " pat-abc",
      }),
    ).toBe("[secret] failed");
    expect(
      pluginErrorMessage(new Error("Refused pat-abc"), plugin, {
        token: "pat-abc\n",
      }),
    ).toBe("Refused [secret]");
  });

  it("keeps the end of a message that was not cut, even when it starts a secret", () => {
    expect(
      pluginErrorMessage(new Error("Too many requests"), plugin, {
        teamSecret: "s3cret",
      }),
    ).toBe("Too many requests");
  });

  it("treats a stored value the manifest no longer declares as secret, but not Ajour's own fields", () => {
    expect(
      pluginErrorMessage(
        new Error(
          "Old key old-key-4f2a failed for Acme (Main) at https://acme.example after 15 minutes.",
        ),
        plugin,
        {
          siteUrl: "https://acme.example",
          apiKey: "old-key-4f2a",
          label: "Main",
          tenantLabel: "Acme",
          autoSyncIntervalMinutes: 15,
        },
      ),
    ).toBe(
      "Old key [secret] failed for Acme (Main) at https://acme.example after 15 minutes.",
    );
  });

  it("only bounds the error of an operation with no connection", () => {
    expect(
      connectionlessPluginErrorMessage(new Error("Row 3 has no project.")),
    ).toBe("Row 3 has no project.");
    expect(connectionlessPluginErrorMessage(new Error("x".repeat(1_500)))).toBe(
      `${"x".repeat(999)}…`,
    );
  });

  it("says Unknown error for a thrown value that isn't an Error", () => {
    expect(pluginErrorMessage("pat-7c1e9a2b4d6f8a0c", plugin)).toBe(
      "Unknown error",
    );
  });
});

describe("redacting twice", () => {
  it("gives the same text when it redacts its own result", () => {
    const config = {
      token: "secret",
      pin: 4829,
      teamSecret: "pat-7c1e9a2b4d6f8a0c",
    };
    for (const raw of [
      "Token secret and PIN 4829 were refused.",
      // Split by the worker's cut.
      `${"x".repeat(20)} pat-7c1e9a…`,
      // The bound falls inside the [secret] that replaces "secret".
      `${"x".repeat(995)}secret${"y".repeat(20)}`,
      // The bound leaves "pat", which starts a secret, before its ellipsis.
      `${"x".repeat(996)}patrol`,
    ]) {
      const once = pluginErrorMessage(new Error(raw), plugin, config);
      expect(pluginErrorMessage(new Error(once), plugin, config)).toBe(once);
    }
  });
});

describe("redacting a connection summary", () => {
  const summarySecrets = connectionSecretValues(plugin, [
    { siteUrl: "https://acme.example", token: "pat-abc", pin: 482913 },
  ]);

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
    const manySecrets = connectionSecretValues(plugin, [
      Object.fromEntries(
        Array.from({ length: 20_000 }, (_, index) => [
          `old${index}`,
          `old-value-${index}`,
        ]),
      ),
    ]);
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
    expect(performance.now() - started).toBeLessThan(QUICK_MS);
  });
});

describe("the redaction's work budget", () => {
  const UNCHECKED = "Hidden because it couldn't be checked for secrets.";
  const undeclared = (values: string[]) =>
    connectionSecretValues(plugin, [
      Object.fromEntries(values.map((value, index) => [`old${index}`, value])),
    ]);
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
    expect(performance.now() - started).toBeLessThan(QUICK_MS);

    // Every secret is longer than every value, so only the cut rule reads
    // them, and none starts where a value is cut.
    const restarted = performance.now();
    expect(
      redactConnectionSummary(summaryOf(`${"a".repeat(998)}b…`), longSecrets),
    ).toEqual(summaryOf(`${"a".repeat(998)}b…`));
    expect(performance.now() - restarted).toBeLessThan(QUICK_MS);
  });
});

describe("one redaction per connection and request", () => {
  const UNCHECKED = "Hidden because it couldn't be checked for secrets.";
  // A short token, and `count` undeclared values of 4,000 characters.
  const secretsWith = (count: number) =>
    connectionSecretValues(plugin, [
      {
        token: "key-7",
        ...Object.fromEntries(
          Array.from({ length: count }, (_, index) => [
            `old${index}`,
            `${"k".repeat(3_990)}${index}`,
          ]),
        ),
      },
    ]);
  const messages = Array.from({ length: 20_000 }, (_, index) =>
    index === 7 ? "PATCH failed with key-7." : "Estimate rejected.",
  );

  it.each([20, 240])(
    "redacts 20,000 field messages against %i long secrets quickly, as one call per message would",
    (count) => {
      const secrets = secretsWith(count);
      const redaction = connectionRedaction(secrets);

      const started = performance.now();
      const redacted = messages.map((message) => redaction.text(message));
      expect(performance.now() - started).toBeLessThan(QUICK_MS);

      expect(redacted[7]).toBe("PATCH failed with [secret].");
      expect(redacted).toEqual(
        messages.map((message) => redactPluginText(message, secrets)),
      );
    },
  );

  it("hides a text past its own budget, and goes on with the next", () => {
    const redaction = connectionRedaction(["s3cret"]);

    expect(redaction.text("x".repeat(300_000))).toBe(UNCHECKED);
    expect(redaction.text("Bad s3cret.")).toBe("Bad [secret].");
  });

  it("stays quick when 20,000 stored values meet 20,000 cut messages", () => {
    const started = performance.now();
    const redaction = connectionRedaction(
      Array.from(
        { length: 20_000 },
        (_, index) => `stored-value-${index}-abcdefgh`,
      ),
    );
    const results = Array.from({ length: 20_000 }, () =>
      redaction.text("Estimate rejected…"),
    );

    expect(performance.now() - started).toBeLessThan(QUICK_MS);
    // Each needs the cut rule against all 20,000, past its own budget.
    expect(results.every((result) => result === UNCHECKED)).toBe(true);
  });

  it("stays quick when 100,000 short secrets meet 100,000 messages", () => {
    const started = performance.now();
    const redaction = connectionRedaction(
      Array.from(
        { length: 100_000 },
        (_, index) => `s${index.toString(36).padStart(5, "0")}`,
      ),
    );
    const results = Array.from({ length: 100_000 }, () =>
      redaction.text("Estimate rejected."),
    );

    expect(performance.now() - started).toBeLessThan(QUICK_MS);
    // Every secret could be in each message, past its own budget.
    expect(results.every((result) => result === UNCHECKED)).toBe(true);
  });

  it("hides the rest once the request's budget is spent, but not a text no secret can be in", () => {
    const redaction = connectionRedaction(["s3cret"]);
    const big = `${"x".repeat(199_993)}s3cret!`;

    const results = Array.from({ length: 40 }, () => redaction.text(big));

    expect(results[0]).toBe(`${"x".repeat(999)}…`);
    expect(results.at(-1)).toBe(UNCHECKED);
    expect(redaction.text("Bad s3cret.")).toBe(UNCHECKED);
    // Shorter than the secret and not cut, so no secret can be in it.
    expect(redaction.text("Bad")).toBe("Bad");
  });
});
