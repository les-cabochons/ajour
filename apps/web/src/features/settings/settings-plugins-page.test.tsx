// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { SettingsPluginsPage } from "./settings-plugins-page";
import * as api from "@/lib/app-api";
import type { PluginsOverview } from "@ajour/shared";
vi.mock("@/lib/app-api", async (original) => ({
  ...(await original<typeof api>()),
  getPluginsOverview: vi.fn(),
  getPluginCatalog: vi.fn(async () => ({
    entries: [],
    sources: [],
    source: "cache",
  })),
  getPluginCatalogSettings: vi.fn(async () => ({
    refreshMinutes: 15,
    allowUnsignedInstalls: false,
  })),
  getProjectDataShapePlugins: vi.fn(async () => []),
  subscribePluginsOverview: () => () => {},
  setPluginProcessAcceptance: vi.fn(),
  setUnsignedPluginProcessesEnabled: vi.fn(),
}));
installDomShims();
afterEach(cleanup);
const plugin = {
  id: "process-test",
  version: "1.0.0",
  apiVersion: 4 as const,
  displayName: "Process test",
  iconSvg: "<svg/>",
  entrypoint: "index.js",
  connectionFields: [],
  capabilities: { connector: {} },
  processes: { executables: {}, commands: [], openSchemes: ["codex"] },
  origin: {
    kind: "source" as const,
    signed: true,
    installedAt: "2026-11-16T00:00:00Z",
  },
};
function overview(): PluginsOverview {
  return {
    pluginsEnabled: true,
    unsignedPluginsEnabled: false,
    unsignedPluginProcessesEnabled: false,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        connections: [],
        processGate: {
          required: true,
          accepted: false,
          packageKey: "development-package-key",
          reason: "unsigned_processes_off",
        },
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}
it("the page saves the process switch through the workflow", async () => {
  const value = overview();
  vi.mocked(api.getPluginsOverview).mockResolvedValue(value);
  vi.mocked(api.setUnsignedPluginProcessesEnabled).mockResolvedValue({
    ...value,
    unsignedPluginProcessesEnabled: true,
  });
  await renderRoutes({ routes: { "/": () => <SettingsPluginsPage /> } });
  fireEvent.click(
    await screen.findByRole("switch", {
      name: "Unsigned plugins can start processes",
    }),
  );
  await waitFor(() =>
    expect(api.setUnsignedPluginProcessesEnabled).toHaveBeenCalledWith(true),
  );
});
it("a development process gate preserves signed activation and sends the displayed package key", async () => {
  const value = overview();
  vi.mocked(api.getPluginsOverview).mockResolvedValue(value);
  vi.mocked(api.setPluginProcessAcceptance).mockResolvedValue(value);
  await renderRoutes({
    routes: { "/": () => <SettingsPluginsPage pluginId={plugin.id} /> },
  });
  const control = await screen.findByRole("checkbox", {
    name: "Allow this plugin to start processes",
  });
  expect(screen.queryByText("Unsigned")).toBeNull();
  fireEvent.click(control);
  await waitFor(() =>
    expect(api.setPluginProcessAcceptance).toHaveBeenCalledWith(
      plugin.id,
      "development-package-key",
      true,
    ),
  );
});
it("lists a handoff plugin under the Handoff tools filter", async () => {
  vi.mocked(api.getPluginsOverview).mockResolvedValue(overview());
  vi.mocked(api.getPluginCatalog).mockResolvedValueOnce({
    entries: [
      {
        id: "agent-handoff",
        title: "Agent handoff",
        description: "Hand off backlog items to coding tools.",
        version: "0.9.0",
        author: { name: "Ajour", url: "https://github.com/les-cabochons" },
        license: { name: "MIT License", spdxId: "MIT" },
        status: "available",
        compatibility: { pluginApiVersion: 4 },
        capabilities: ["handoff"],
        features: ["agent-handoff"],
        install: { method: "source" },
        tags: ["agents"],
      },
    ],
    sources: [],
    source: "cache",
    checkedAt: "2026-11-17T00:00:00Z",
  });
  await renderRoutes({ routes: { "/": () => <SettingsPluginsPage /> } });
  const tab = await screen.findByRole("tab", { name: "Handoff tools" });
  fireEvent.click(tab);
  await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
  const card = await screen.findByRole("link", { name: "View Agent handoff" });
  expect(card.textContent).toContain("Handoff tools");
  expect(screen.queryByRole("link", { name: "View Process test" })).toBeNull();
});
