import { expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { connectionBaseAddress } from "./broker-policy.ts";

function manifest(allowOnPremises: boolean) {
  return pluginApi4ManifestSchema.parse({
    id: "opencode",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "OpenCode",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    connectionFields: [
      { id: "serverUrl", label: "Server URL", type: "url", required: true },
    ],
    network: { baseAddress: { field: "serverUrl", allowOnPremises } },
    capabilities: {
      handoff: {
        tools: [
          {
            id: "opencode",
            label: "OpenCode",
            iconSvg: "<svg/>",
            settings: [],
            connection: "required",
          },
        ],
      },
    },
  });
}

const connection = (serverUrl: string, onPremises: boolean) => ({
  id: "c1",
  values: { serverUrl },
  secrets: [],
  onPremises,
  access: [],
});

it("gives an on-premises connection's loopback address, without a trailing slash", () => {
  expect(
    connectionBaseAddress(
      manifest(true),
      connection("http://127.0.0.1:4096/", true),
    ),
  ).toBe("http://127.0.0.1:4096");
  expect(
    connectionBaseAddress(
      manifest(true),
      connection("https://code.example.test/base/?x=1#y", false),
    ),
  ).toBe("https://code.example.test/base");
});

it.each([
  [
    "an http address not marked on-premises",
    true,
    "http://127.0.0.1:4096",
    false,
  ],
  [
    "on-premises the manifest doesn't allow",
    false,
    "http://127.0.0.1:4096",
    true,
  ],
  ["a user name in the address", true, "https://me:pw@example.test", true],
  ["no address", true, "", true],
])("refuses %s, as the broker would", (_case, allow, url, onPremises) => {
  expect(() =>
    connectionBaseAddress(manifest(allow), connection(url, onPremises)),
  ).toThrow();
});
