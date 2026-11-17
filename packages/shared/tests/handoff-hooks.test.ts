import { describe, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../plugin-api-4.ts";
import {
  commandArgvShape,
  pluginAccessDifference,
  summarizePluginAccess,
  widensAccess,
} from "../plugin-access.ts";
import { startHandoffRequestSchema } from "../handoffs.ts";

const TEMPLATE = '{"hooks":{"Stop":[{"hooks":[{"type":"http","url":"{url}"}]}]}}';

/** A Claude Code-like plugin that passes its hook in a per-start settings flag. */
function claudeManifest(template = TEMPLATE) {
  return pluginApi4ManifestSchema.parse({
    id: "agent-handoff",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "Agent handoff",
    iconSvg: "<svg/>",
    entrypoint: "dist/index.js",
    connectionFields: [],
    capabilities: {
      handoff: {
        tools: [
          { id: "claude", label: "Claude Code", iconSvg: "<svg/>", settings: [] },
        ],
      },
    },
    processes: {
      executables: { claude: { names: ["claude"] } },
      commands: [
        {
          id: "start",
          executable: "claude",
          args: [
            "--settings",
            { kind: "hook-url", name: "hook", template },
            "-p",
            "{prompt:text}",
          ],
          mode: "detached",
        },
      ],
    },
  });
}

describe("a handoff's hook URL", () => {
  it("is part of the start request the plugin receives", () => {
    const request = {
      tool: "claude",
      folder: { id: "f", name: "Repo" },
      prompt: "Prompt",
      title: "Title",
      item: { key: "K", url: "" },
      settings: {},
    };
    expect(startHandoffRequestSchema.parse(request)).not.toHaveProperty("hook");
    expect(
      startHandoffRequestSchema.parse({
        ...request,
        hook: { url: "http://127.0.0.1:8787/hooks/handoff/h?token=t" },
      }).hook,
    ).toEqual({ url: "http://127.0.0.1:8787/hooks/handoff/h?token=t" });
  });

  it("shows in Access review with its template, and a changed template needs approval again", () => {
    const manifest = claudeManifest();
    const command = manifest.processes!.commands[0]!;
    expect(commandArgvShape(command, ["claude"])).toBe(
      `claude --settings ${JSON.stringify(TEMPLATE.replace("{url}", "<hook-url>"))} -p <text>`,
    );
    const summary = summarizePluginAccess(manifest, { agentPrompts: {} });
    expect(summary.commands?.[0]?.description).toContain(
      "Receives the address where the handoff's hooks tell Ajour its thread changed.",
    );
    const changed = summarizePluginAccess(
      claudeManifest(TEMPLATE.replace("Stop", "Notification")),
      { agentPrompts: {} },
    );
    expect(widensAccess(pluginAccessDifference(summary, changed))).toBe(true);
  });
});
