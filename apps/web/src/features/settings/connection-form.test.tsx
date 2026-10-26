import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PluginOverviewGroup } from "@ajour/shared";
import { PluginConnectionForm } from "./connection-form";
import { createPluginFormState } from "./plugin-form-state";

const plugin = {
  id: "tracker",
  version: "1.0.0",
  apiVersion: 3 as const,
  displayName: "Tracker",
  description: "Test",
  iconSvg: "<svg />",
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [
    {
      id: "label",
      label: "Label",
      type: "text" as const,
      required: true,
      secret: false,
    },
  ],
};
const connection = {
  id: "c1",
  label: "Acme",
  editableValues: { label: "Acme" },
} as never;

/** An edit of the label, so only the plugin's state keeps Save off. */
function render(group: Partial<PluginOverviewGroup>, saveHint?: string) {
  const edited = createPluginFormState(1, plugin, connection);
  return renderToStaticMarkup(
    <PluginConnectionForm
      group={{ plugin, enabled: true, connections: [], ...group }}
      form={{ ...edited, values: { label: "Renamed" } }}
      setForm={() => {}}
      connection={undefined}
      vault={undefined}
      isMutating={false}
      now={0}
      onCancel={() => {}}
      onSave={() => {}}
      onRemoveSecret={() => {}}
      saveHint={saveHint}
    />,
  );
}

function saveButton(markup: string) {
  return /<button[^>]*>Update connection<\/button>/.exec(markup)?.[0] ?? "";
}

describe("the connection form on a plugin that can't save", () => {
  it("saves on a plugin that is on", () => {
    const markup = render({});
    expect(saveButton(markup)).not.toContain(`disabled=""`);
  });

  it("disables Save and says how to activate, next to the buttons, on an inactive plugin", () => {
    const hint = "Activate this plugin to save a connection.";
    const markup = render({ enabled: false }, hint);
    expect(saveButton(markup)).toContain(`disabled=""`);
    expect(markup).toContain(hint);
  });
});
