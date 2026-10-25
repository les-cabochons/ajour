import { describe, expect, it } from "vitest";
import type { PluginManifest } from "@ajour/shared";
import {
  arePluginFormValuesEqual,
  areExpiryDraftsEqual,
  areExpiryDraftsValid,
  buildExpiryDrafts,
  buildPluginFormValues,
  canSubmitPluginForm,
  expiryForSave,
  isPluginFieldShown,
  secretFieldsKey,
} from "./plugin-form-state";

const plugin: PluginManifest = {
  id: "azure_devops",
  version: "1.0.0",
  apiVersion: 3,
  displayName: "Azure DevOps",
  description: "Test plugin",
  iconSvg: "<svg />",
  entrypoint: "plugin.js",
  capabilities: { connector: {} },
  connectionFields: [
    {
      id: "label",
      label: "Label",
      type: "text",
      required: true,
      secret: false,
    },
    {
      id: "personalAccessToken",
      label: "PAT",
      type: "password",
      required: true,
      secret: true,
    },
    {
      id: "taskIconDisplayMode",
      label: "Task icon",
      type: "select",
      required: true,
      secret: false,
      defaultValue: "always",
      options: [
        { value: "always", label: "Always" },
        { value: "fallback", label: "Fallback" },
      ],
    },
  ],
};

const both: PluginManifest = {
  ...plugin,
  capabilities: { connector: {}, codeHost: {} },
  connectionFields: [
    ...plugin.connectionFields,
    {
      id: "pullRequestsInclude",
      label: "Only these repositories",
      type: "text",
      required: true,
      secret: false,
      capability: "codeHost",
    },
    {
      id: "autoSyncIntervalMinutes",
      label: "Interval",
      type: "number",
      required: true,
      secret: false,
    },
  ],
};
const field = (id: string) =>
  both.connectionFields.find((candidate) => candidate.id === id)!;

describe("capability fields", () => {
  it("hides and skips the required check of a field whose capability is off", () => {
    const values = {
      label: "Work",
      personalAccessToken: "secret",
      taskIconDisplayMode: "always",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
    };
    expect(isPluginFieldShown(both, field("pullRequestsInclude"), values)).toBe(
      true,
    );
    expect(canSubmitPluginForm(both, values)).toBe(false);

    expect(
      isPluginFieldShown(both, field("pullRequestsInclude"), values, [
        "codeHost",
      ]),
    ).toBe(false);
    expect(
      canSubmitPluginForm(both, values, {
        inactiveCapabilities: ["codeHost"],
      }),
    ).toBe(true);
  });

  it("shows the interval while backlog items or pull requests sync on it", () => {
    const interval = field("autoSyncIntervalMinutes");
    const off = { autoSync: false, pullRequestAutoSync: false };
    expect(isPluginFieldShown(both, interval, off)).toBe(false);
    expect(
      isPluginFieldShown(both, interval, {
        ...off,
        pullRequestAutoSync: true,
      }),
    ).toBe(true);
    expect(
      isPluginFieldShown(
        both,
        interval,
        { ...off, pullRequestAutoSync: true },
        ["codeHost"],
      ),
    ).toBe(false);
    expect(
      isPluginFieldShown(both, interval, { ...off, autoSync: true }, [
        "codeHost",
      ]),
    ).toBe(true);
    expect(
      isPluginFieldShown(both, interval, { ...off, autoSync: true }, [
        "connector",
      ]),
    ).toBe(false);
    // Saved before pull requests had their own setting: they follow auto sync.
    expect(
      isPluginFieldShown(
        { ...both, capabilities: { codeHost: {} } },
        interval,
        {
          autoSync: true,
        },
      ),
    ).toBe(true);
  });
});

describe("plugin form state", () => {
  it("starts a comment plugin's agent access at None and keeps a saved level", () => {
    const withComments: PluginManifest = {
      ...plugin,
      capabilities: { connector: { comments: {} } },
    };

    expect(buildPluginFormValues(withComments).agentAccess).toBe("none");
    expect(
      buildPluginFormValues(withComments, { agentAccess: "read" }).agentAccess,
    ).toBe("read");
    expect(buildPluginFormValues(plugin)).not.toHaveProperty("agentAccess");
  });

  it("starts every secret field empty, with no mask, whether or not one is saved", () => {
    expect(buildPluginFormValues(plugin)).toMatchObject({
      personalAccessToken: "",
    });
    expect(
      buildPluginFormValues(plugin, {
        label: "Main",
        taskIconDisplayMode: "fallback",
      }),
    ).toEqual({
      label: "Main",
      personalAccessToken: "",
      taskIconDisplayMode: "fallback",
    });
  });

  it("never takes a secret field's value from the saved values", () => {
    // The API sends none, but a form must not start with one even if it did.
    expect(
      buildPluginFormValues(plugin, {
        label: "Main",
        personalAccessToken: "leaked-by-mistake",
      }).personalAccessToken,
    ).toBe("");
  });

  it("allows editing an existing connection without re-entering a saved secret", () => {
    expect(
      canSubmitPluginForm(
        plugin,
        {
          label: "Main",
          personalAccessToken: "",
          taskIconDisplayMode: "fallback",
        },
        { savedSecrets: new Set(["personalAccessToken"]) },
      ),
    ).toBe(true);
  });

  it("requires a secret that isn't saved, such as one that was removed", () => {
    const values = {
      label: "Main",
      personalAccessToken: "",
      taskIconDisplayMode: "fallback",
    };
    expect(canSubmitPluginForm(plugin, values)).toBe(false);
    expect(
      canSubmitPluginForm(plugin, values, { savedSecrets: new Set() }),
    ).toBe(false);
    expect(
      canSubmitPluginForm(
        plugin,
        { ...values, personalAccessToken: "new-token" },
        { savedSecrets: new Set() },
      ),
    ).toBe(true);
  });

  it("starts the reminder dates from the secrets the vault holds", () => {
    const expiresAt = new Date(2026, 9, 28, 23, 59, 59, 999).getTime();
    expect(buildExpiryDrafts(["personalAccessToken"])).toEqual({
      personalAccessToken: "",
    });
    expect(
      buildExpiryDrafts(
        ["personalAccessToken"],
        [{ id: "personalAccessToken", expiresAt }],
      ),
    ).toEqual({ personalAccessToken: "2026-10-28" });
  });

  it("sends a reminder date as the end of its day, and clears an empty one", () => {
    expect(expiryForSave({ personalAccessToken: "2026-10-28" })).toEqual({
      personalAccessToken: new Date(2026, 9, 28, 23, 59, 59, 999).getTime(),
    });
    expect(expiryForSave({ personalAccessToken: "" })).toEqual({
      personalAccessToken: null,
    });
  });

  it("sends only the reminder dates that changed, so a save that touches no date asks nothing of the vault", () => {
    const initial = { token: "2026-10-28", note: "", feed: "" };

    expect(expiryForSave(initial, initial)).toEqual({});
    expect(
      expiryForSave(
        { token: "2026-11-02", note: "", feed: "2026-12-01" },
        initial,
      ),
    ).toEqual({
      token: new Date(2026, 10, 2, 23, 59, 59, 999).getTime(),
      feed: new Date(2026, 11, 1, 23, 59, 59, 999).getTime(),
    });
    // Emptying the date clears it.
    expect(expiryForSave({ ...initial, token: "" }, initial)).toEqual({
      token: null,
    });
  });

  it("sends the date shown with a secret that is replaced, since the new secret starts without one", () => {
    const initial = { token: "2026-10-28", note: "" };

    expect(expiryForSave(initial, initial, ["token"])).toEqual({
      token: new Date(2026, 9, 28, 23, 59, 59, 999).getTime(),
    });
    expect(expiryForSave(initial, initial, ["note"])).toEqual({ note: null });
  });

  it("keeps a task form while the overview refreshes what a secret last did, and starts it over when its state or date changes", () => {
    const saved = { id: "apiKey", state: "saved" as const, setAt: 1 };

    const key = secretFieldsKey([saved]);

    expect(secretFieldsKey([{ ...saved, lastUsedAt: 99 }])).toBe(key);
    expect(
      secretFieldsKey([{ ...saved, state: "rejected" as const }]),
    ).not.toBe(key);
    expect(secretFieldsKey([{ ...saved, expiresAt: 5 }])).not.toBe(key);
    expect(secretFieldsKey([])).not.toBe(key);
  });

  it("accepts an empty date or a whole one, and tells when dates changed", () => {
    expect(areExpiryDraftsValid({ a: "", b: "2026-10-28" })).toBe(true);
    expect(areExpiryDraftsValid({ a: "2026-10" })).toBe(false);
    expect(areExpiryDraftsEqual({ a: "2026-10-28" }, { a: "2026-10-28" })).toBe(
      true,
    );
    expect(areExpiryDraftsEqual({ a: "2026-10-29" }, { a: "2026-10-28" })).toBe(
      false,
    );
    expect(areExpiryDraftsEqual({ a: "" }, {})).toBe(true);
  });

  it("treats unchanged edit values as equal", () => {
    const initialValues = buildPluginFormValues(plugin, {
      label: "Main",
      taskIconDisplayMode: "fallback",
    });

    expect(arePluginFormValuesEqual(plugin, initialValues, initialValues)).toBe(
      true,
    );
  });

  it("detects changes in edit values", () => {
    const initialValues = buildPluginFormValues(plugin, {
      label: "Main",
      taskIconDisplayMode: "fallback",
    });

    expect(
      arePluginFormValuesEqual(
        plugin,
        {
          ...initialValues,
          taskIconDisplayMode: "always",
        },
        initialValues,
      ),
    ).toBe(false);
  });
});
