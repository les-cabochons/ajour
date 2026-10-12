import { describe, expect, it } from "vitest";
import {
  CONNECTOR_PLUGIN_API_VERSION,
  connectorPluginManifestSchema,
  pluginHasCodeHost,
  pluginHasConnector,
} from "../src/connectors";

const validManifest = {
  id: "example_connector",
  version: "1.2.3",
  apiVersion: CONNECTOR_PLUGIN_API_VERSION,
  displayName: "Example connector",
  iconSvg: "<svg viewBox='0 0 16 16' />",
  entrypoint: "dist/plugin.js",
  capabilities: { connector: {} },
  connectionFields: [
    {
      id: "endpoint",
      label: "Endpoint",
      type: "url",
      required: true,
    },
  ],
};

describe("connector plugin manifest", () => {
  it("accepts a versioned installable connector contract", () => {
    expect(connectorPluginManifestSchema.parse(validManifest)).toMatchObject({
      id: "example_connector",
      version: "1.2.3",
      apiVersion: CONNECTOR_PLUGIN_API_VERSION,
    });
  });

  it("rejects identifiers that could create nested install paths", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...validManifest,
        id: "../outside",
      }),
    ).toThrow();
  });

  it("rejects manifests without a semantic version", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...validManifest,
        version: "latest",
      }),
    ).toThrow();
  });

  it("rejects manifests that declare no capability", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...validManifest,
        capabilities: {},
      }),
    ).toThrow("connector capability, the codeHost capability or both");
  });

  it("accepts a plugin that is both a connector and a code host", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...validManifest,
      capabilities: { connector: { settle: true }, codeHost: {} },
    });
    expect(pluginHasConnector(manifest)).toBe(true);
    expect(pluginHasCodeHost(manifest)).toBe(true);
  });

  it("accepts a code host without the connector capability", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...validManifest,
      capabilities: { codeHost: {} },
    });
    expect(pluginHasConnector(manifest)).toBe(false);
    expect(pluginHasCodeHost(manifest)).toBe(true);
  });
});
