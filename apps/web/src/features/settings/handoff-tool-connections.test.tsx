// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getHandoffToolConnections: vi.fn(),
  saveHandoffToolConnections: vi.fn(),
}));
vi.mock("@/lib/app-api", () => api);

import { PluginHandoffConnections } from "./handoff-tool-connections";
import { installDomShims, renderRoutes } from "@/test-support/dom";
installDomShims();
afterEach(cleanup);
beforeEach(() => {
  api.getHandoffToolConnections.mockReset();
  api.saveHandoffToolConnections.mockReset();
});

const tools = [
  { id: "opencode", label: "OpenCode", connection: "required" as const },
  { id: "t3", label: "T3", connection: "none" as const },
];
const connections = [
  { id: "c1", label: "Laptop server" },
  { id: "c2", label: "Desktop server" },
];

async function choose(select: HTMLElement, name: string) {
  fireEvent.click(select);
  const option = await screen.findByRole("option", { name });
  fireEvent.keyDown(option, { key: "Enter" });
  fireEvent.click(option);
}

async function render(
  props: Partial<Parameters<typeof PluginHandoffConnections>[0]> = {},
) {
  await renderRoutes({
    routes: {
      "/": () => (
        <PluginHandoffConnections
          pluginId="opencode"
          tools={tools}
          connections={connections}
          {...props}
        />
      ),
    },
  });
}

it("picks the connection a tool hands off through, and saves it", async () => {
  api.getHandoffToolConnections.mockResolvedValue({});
  api.saveHandoffToolConnections.mockImplementation(
    async (_plugin: string, picks: Record<string, string>) => picks,
  );
  await render();
  const select = await screen.findByRole("combobox", {
    name: "OpenCode connection",
  });
  // Only the tool that uses a connection has a pick.
  expect(screen.queryByRole("combobox", { name: "T3 connection" })).toBeNull();
  expect(select.textContent).toContain("Choose a connection");
  await choose(select, "Desktop server");
  await waitFor(() =>
    expect(api.saveHandoffToolConnections).toHaveBeenCalledWith("opencode", {
      opencode: "c2",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "OpenCode connection" }).textContent,
    ).toContain("Desktop server"),
  );
});

it("shows the saved pick, and says the only connection is used without one", async () => {
  api.getHandoffToolConnections.mockResolvedValue({ opencode: "c1" });
  await render();
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "OpenCode connection" }).textContent,
    ).toContain("Laptop server"),
  );
  cleanup();
  api.getHandoffToolConnections.mockResolvedValue({});
  await render({ connections: [connections[0]!] });
  expect(
    await screen.findByText(
      "Uses Laptop server, the plugin's only connection.",
    ),
  ).toBeTruthy();
});

it("asks for a connection first when the plugin has none", async () => {
  api.getHandoffToolConnections.mockResolvedValue({});
  await render({ connections: [] });
  expect(
    await screen.findByText(
      "Add a connection above. OpenCode hands off through one.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("shows why a save failed", async () => {
  api.getHandoffToolConnections.mockResolvedValue({});
  api.saveHandoffToolConnections.mockRejectedValue(
    new Error("This connection no longer exists."),
  );
  await render();
  await choose(
    await screen.findByRole("combobox", { name: "OpenCode connection" }),
    "Laptop server",
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This connection no longer exists.",
  );
});

it("renders nothing for a plugin whose tools use no connection", async () => {
  api.getHandoffToolConnections.mockResolvedValue({});
  await render({ tools: [tools[1]!] });
  expect(screen.queryByText(/connection/i)).toBeNull();
  expect(api.getHandoffToolConnections).not.toHaveBeenCalled();
});

it("forgets a deleted connection's pick, so another tool's pick still saves", async () => {
  api.getHandoffToolConnections.mockResolvedValue({ opencode: "c1" });
  api.saveHandoffToolConnections.mockImplementation(
    async (_plugin: string, picks: Record<string, string>) => picks,
  );
  const twoTools = [
    tools[0]!,
    { id: "claude", label: "Claude", connection: "required" as const },
  ];
  // The plugin's page passes its connections, and deleting one changes them.
  function Page() {
    const [list, setList] = useState(connections);
    return (
      <>
        <button type="button" onClick={() => setList([connections[1]!])}>
          Delete Laptop server
        </button>
        <PluginHandoffConnections
          pluginId="opencode"
          tools={twoTools}
          connections={list}
        />
      </>
    );
  }
  await renderRoutes({ routes: { "/": Page } });
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "OpenCode connection" }).textContent,
    ).toContain("Laptop server"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete Laptop server" }));
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "OpenCode connection" }).textContent,
    ).not.toContain("c1"),
  );
  expect(
    screen.getByRole("combobox", { name: "OpenCode connection" }).textContent,
  ).toContain("Choose a connection");
  await choose(
    screen.getByRole("combobox", { name: "Claude connection" }),
    "Desktop server",
  );
  await waitFor(() =>
    expect(api.saveHandoffToolConnections).toHaveBeenCalledWith("opencode", {
      claude: "c2",
    }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});
