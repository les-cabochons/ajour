import { describe, expect, it } from "vitest";
import type { ConnectorPluginManifest } from "@ajour/shared";
import {
  areConnectorFormValuesEqual,
  buildConnectorFormValues,
  canSubmitConnectorForm,
  isConnectorFieldShown,
  normalizeConnectorFormValuesForSave,
  SAVED_SECRET_MASK,
} from "./connector-form-state";

const plugin: ConnectorPluginManifest = {
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

const both: ConnectorPluginManifest = {
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
    expect(
      isConnectorFieldShown(both, field("pullRequestsInclude"), values),
    ).toBe(true);
    expect(canSubmitConnectorForm(both, values)).toBe(false);

    expect(
      isConnectorFieldShown(both, field("pullRequestsInclude"), values, [
        "codeHost",
      ]),
    ).toBe(false);
    expect(
      canSubmitConnectorForm(both, values, {
        inactiveCapabilities: ["codeHost"],
      }),
    ).toBe(true);
  });

  it("shows the interval while work items or pull requests sync on it", () => {
    const interval = field("autoSyncIntervalMinutes");
    const off = { autoSync: false, pullRequestAutoSync: false };
    expect(isConnectorFieldShown(both, interval, off)).toBe(false);
    expect(
      isConnectorFieldShown(both, interval, {
        ...off,
        pullRequestAutoSync: true,
      }),
    ).toBe(true);
    expect(
      isConnectorFieldShown(
        both,
        interval,
        { ...off, pullRequestAutoSync: true },
        ["codeHost"],
      ),
    ).toBe(false);
    expect(
      isConnectorFieldShown(both, interval, { ...off, autoSync: true }, [
        "codeHost",
      ]),
    ).toBe(true);
    expect(
      isConnectorFieldShown(both, interval, { ...off, autoSync: true }, [
        "connector",
      ]),
    ).toBe(false);
    // Saved before pull requests had their own setting: they follow auto sync.
    expect(
      isConnectorFieldShown(
        { ...both, capabilities: { codeHost: {} } },
        interval,
        {
          autoSync: true,
        },
      ),
    ).toBe(true);
  });
});

describe("connector form state", () => {
  it("masks secret fields when building edit values", () => {
    expect(
      buildConnectorFormValues(plugin, {
        label: "Main",
        taskIconDisplayMode: "fallback",
      }),
    ).toEqual({
      label: "Main",
      personalAccessToken: SAVED_SECRET_MASK,
      taskIconDisplayMode: "fallback",
    });
  });

  it("allows editing an existing connection without re-entering the secret", () => {
    expect(
      canSubmitConnectorForm(
        plugin,
        {
          label: "Main",
          personalAccessToken: SAVED_SECRET_MASK,
          taskIconDisplayMode: "fallback",
        },
        { allowSavedSecrets: true },
      ),
    ).toBe(true);
  });

  it("still requires the secret when creating a new connection", () => {
    expect(
      canSubmitConnectorForm(plugin, {
        label: "Main",
        personalAccessToken: "",
        taskIconDisplayMode: "fallback",
      }),
    ).toBe(false);
  });

  it("normalizes an unchanged saved secret mask back to an empty value on save", () => {
    expect(
      normalizeConnectorFormValuesForSave(
        plugin,
        {
          label: "Main",
          personalAccessToken: SAVED_SECRET_MASK,
          taskIconDisplayMode: "fallback",
        },
        { allowSavedSecrets: true },
      ),
    ).toEqual({
      label: "Main",
      personalAccessToken: "",
      taskIconDisplayMode: "fallback",
    });
  });

  it("preserves a newly entered secret on save", () => {
    expect(
      normalizeConnectorFormValuesForSave(
        plugin,
        {
          label: "Main",
          personalAccessToken: "new-token",
          taskIconDisplayMode: "fallback",
        },
        { allowSavedSecrets: true },
      ),
    ).toEqual({
      label: "Main",
      personalAccessToken: "new-token",
      taskIconDisplayMode: "fallback",
    });
  });

  it("treats unchanged edit values as equal", () => {
    const initialValues = buildConnectorFormValues(plugin, {
      label: "Main",
      taskIconDisplayMode: "fallback",
    });

    expect(
      areConnectorFormValuesEqual(plugin, initialValues, initialValues),
    ).toBe(true);
  });

  it("detects changes in edit values", () => {
    const initialValues = buildConnectorFormValues(plugin, {
      label: "Main",
      taskIconDisplayMode: "fallback",
    });

    expect(
      areConnectorFormValuesEqual(
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
