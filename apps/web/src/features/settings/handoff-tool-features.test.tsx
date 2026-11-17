// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { PluginHandoffTools } from "./handoff-tool-features";
import { installDomShims, renderRoutes } from "@/test-support/dom";

installDomShims();
afterEach(cleanup);

const tools = [
  { id: "claude", label: "Claude Code", followsState: true },
  { id: "t3", label: "T3 Code", followsState: true, listsThreads: true },
  { id: "copilot", label: "Copilot CLI", followsState: false },
];

it("lists each handoff tool with the features it supports", async () => {
  await renderRoutes({
    routes: { "/": () => <PluginHandoffTools tools={tools} hooks /> },
  });
  expect(
    await screen.findByRole("heading", { name: "Handoff tools" }),
  ).toBeTruthy();
  const row = (label: string) =>
    screen.getByText(label).closest(".settings-row")!.textContent;
  expect(row("Claude Code")).toContain(
    "Starts threads · Follows state · Updates within seconds",
  );
  expect(row("T3 Code")).toContain(
    "Starts threads · Follows state · Finds threads · Updates within seconds",
  );
  // A hook only makes Ajour read state, which Copilot CLI doesn't give.
  expect(row("Copilot CLI")).toContain("Starts threads");
  expect(row("Copilot CLI")).not.toContain("Follows state");
  expect(row("Copilot CLI")).not.toContain("Updates within seconds");
});

it("leaves updates within seconds out when the plugin passes no hook", async () => {
  await renderRoutes({
    routes: { "/": () => <PluginHandoffTools tools={tools} hooks={false} /> },
  });
  expect(
    (await screen.findByText("Claude Code")).closest(".settings-row")!
      .textContent,
  ).not.toContain("Updates within seconds");
});
