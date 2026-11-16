// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
vi.mock("./plugin-command-access", () => ({
  PluginCommandAccess: () => <p>Command mode controls</p>,
}));
import { NO_PLUGIN_ACCESS } from "@ajour/shared";
import {
  PluginAccessSection,
  PluginAccessUpdatePanel,
} from "./plugin-access-section";
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
                undeclaredCommands: true,
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
  expect(screen.getByText("Undeclared commands")).toBeTruthy();
  expect(
    screen.getByText(/a command no rule marks risky runs without asking/),
  ).toBeTruthy();
  expect(
    screen.getByText(
      /These commands and links run as you, outside the sandbox/,
    ),
  ).toBeTruthy();
  expect(screen.getByText(/outside G1/)).toBeTruthy();
});

it.each(["commands", "schemes", "both", "neither"])(
  "shows the process warning for an update adding %s",
  async (kind) => {
    const commands =
      kind === "commands" || kind === "both"
        ? [{ id: "run", argv: "node <text>", policy: "{}" }]
        : [];
    const openSchemes = kind === "schemes" || kind === "both" ? ["codex"] : [];
    const summary = { ...NO_PLUGIN_ACCESS, commands, openSchemes };
    const { pluginAccessDifference } = await import("@ajour/shared");
    await renderRoutes({
      routes: {
        "/": () => (
          <PluginAccessUpdatePanel
            disabled={false}
            onAllow={() => {}}
            group={{
              enabled: false,
              connections: [],
              plugin: {
                id: "handoff",
                version: "2",
                apiVersion: 4,
                displayName: "Handoff",
                iconSvg: "<svg />",
                connectionFields: [],
                capabilities: {},
              },
              access: { summary, hostLabels: {}, choices: [] },
              pendingAccess: {
                version: "2",
                difference: pluginAccessDifference(undefined, summary),
              },
            }}
          />
        ),
      },
    });
    const warning = screen.queryByText(/outside G1/);
    expect(Boolean(warning)).toBe(kind !== "neither");
    if (warning) {
      expect(warning.textContent).toContain(
        "every plugin's credentials, not only its own",
      );
      expect(warning.textContent).toContain("run as you, outside the sandbox");
      expect(warning.textContent).toContain(
        openSchemes.length ? "commands and links" : "commands",
      );
    }
  },
);

it.each([true, false])(
  "Given a process gate and undeclared commands %s, shows command mode controls only when declared and the G1 note either way",
  async (undeclaredCommands) => {
    await renderRoutes({
      routes: {
        "/": () => (
          <PluginAccessSection
            now={1}
            group={{
              enabled: true,
              connections: [],
              processGate: {
                required: true,
                accepted: true,
                packageKey: "key",
              },
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
                  undeclaredCommands,
                  commands: [{ id: "run", argv: "git status", policy: "{}" }],
                },
              },
            }}
          />
        ),
      },
    });
    expect(Boolean(screen.queryByText("Command mode controls"))).toBe(
      undeclaredCommands,
    );
    expect(screen.getByText(/outside G1/)).toBeTruthy();
  },
);
