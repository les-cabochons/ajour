import { describe, expect, it } from "vitest";
import type { ConnectorPluginManifest } from "@ajour/shared";
import {
  areConnectorFormValuesEqual,
  buildConnectorFormValues,
  canSubmitConnectorForm,
  normalizeConnectorFormValuesForSave,
  SAVED_SECRET_MASK,
} from "./connector-form-state";

const plugin: ConnectorPluginManifest = {
  id: "azure_devops",
  version: "1.0.0",
  apiVersion: 1,
  displayName: "Azure DevOps",
  description: "Test plugin",
  iconSvg: "<svg />",
  entrypoint: "plugin.js",
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
