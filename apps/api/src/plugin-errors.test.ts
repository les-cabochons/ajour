import { describe, expect, it } from "vitest";
import {
  connectionlessPluginErrorMessage,
  pluginErrorMessage,
} from "./plugin-errors.ts";

// The redaction itself, and its tests, live in packages/wide-events.

const plugin = {
  connectionFields: [
    { id: "siteUrl", secret: false },
    { id: "token", secret: true },
    { id: "pin", secret: true },
    { id: "teamSecret", secret: true },
  ],
};

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
