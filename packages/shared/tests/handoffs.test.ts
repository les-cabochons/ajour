import { expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../plugin-api-4.ts";
import {
  summarizePluginAccess,
  pluginAccessDifference,
  widensAccess,
} from "../plugin-access.ts";
import { jiraManifest } from "./fixtures/api-4-manifests.ts";

it("accepts a handoff-only API 4 plugin, requires code and includes it in access consent", () => {
  const base = jiraManifest();
  const manifest = {
    ...base,
    capabilities: {
      handoff: {
        tools: [
          { id: "t3", label: "T3 Code", iconSvg: "<svg/>", settings: [] },
        ],
      },
    },
  };
  const parsed = pluginApi4ManifestSchema.parse(manifest);
  const before = summarizePluginAccess(pluginApi4ManifestSchema.parse(base), {
    agentPrompts: {},
  });
  const after = summarizePluginAccess(parsed, { agentPrompts: {} });
  expect(after.capabilities).toEqual(["handoff"]);
  expect(widensAccess(pluginAccessDifference(before, after))).toBe(true);
  expect(
    pluginApi4ManifestSchema.safeParse({ ...manifest, entrypoint: undefined })
      .success,
  ).toBe(false);
  expect(
    pluginApi4ManifestSchema.safeParse({
      ...manifest,
      capabilities: { handoff: { tools: [] } },
    }).success,
  ).toBe(false);
  const tool = manifest.capabilities.handoff.tools[0]!;
  expect(
    pluginApi4ManifestSchema.safeParse({
      ...manifest,
      capabilities: { handoff: { tools: [tool, tool] } },
    }).success,
  ).toBe(false);
  expect(
    pluginApi4ManifestSchema.safeParse({
      ...manifest,
      capabilities: {
        handoff: {
          tools: [
            {
              ...tool,
              settings: [
                { id: "token", label: "Token", type: "password", secret: true },
              ],
            },
          ],
        },
      },
    }).success,
  ).toBe(false);
});
