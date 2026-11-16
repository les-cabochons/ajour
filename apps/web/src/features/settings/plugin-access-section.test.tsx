// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { NO_PLUGIN_ACCESS } from "@ajour/shared";
import { PluginAccessSection } from "./plugin-access-section";
import { installDomShims, renderRoutes } from "@/test-support/dom";
installDomShims();
afterEach(cleanup);
it("shows declared argv and schemes with the process G1 warning", async () => {
  await renderRoutes({
    routes: {
      "/": () => (
        <PluginAccessSection
          now={1}
          group={{
            enabled: true,
            connections: [],
            plugin: {
              id: "handoff",
              version: "1.0.0",
              apiVersion: 4,
              displayName: "Handoff",
              iconSvg: "<svg />",
              connectionFields: [],
              capabilities: {},
            },
            access: {
              hostLabels: {},
              choices: [],
              summary: {
                ...NO_PLUGIN_ACCESS,
                commands: [
                  {
                    id: "start",
                    argv: "t3 thread start <folder> - --title <text> --json",
                    policy: "{}",
                  },
                ],
                openSchemes: ["codex"],
              },
            },
          }}
        />
      ),
    },
  });
  expect(
    screen.getByText("t3 thread start <folder> - --title <text> --json"),
  ).toBeTruthy();
  expect(screen.getByText("codex:")).toBeTruthy();
  expect(
    screen.getByText(/These commands run as you, outside the sandbox/),
  ).toBeTruthy();
  expect(screen.getByText(/outside G1/)).toBeTruthy();
});
