// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "@/lib/app-api";
import { cachePluginsOverview } from "@/lib/app-api";
import {
  detectHandoffToolsFor,
  forgetHandoffToolDetection,
  getHandoffTools,
  getHandoffToolsChoiceNow,
  resetHandoffToolDetections,
} from "@/lib/handoff-tools";
import { handoffOverview } from "../../tests/fixtures/handoffs";

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  detectHandoffTools: vi.fn(),
}));

beforeEach(() => {
  resetHandoffToolDetections();
  window.ajourDesktop = { chooseFolder: vi.fn() };
  cachePluginsOverview(handoffOverview());
  vi.mocked(api.detectHandoffTools).mockResolvedValue({
    tools: [{ id: "t3", available: true }],
  });
});

afterEach(() => {
  delete window.ajourDesktop;
  vi.resetAllMocks();
});

it("detects again once the plugin's detection is forgotten, as after a new connection pick", async () => {
  await detectHandoffToolsFor("p");
  await detectHandoffToolsFor("p");
  // A detection younger than a minute is reused.
  expect(api.detectHandoffTools).toHaveBeenCalledTimes(1);

  forgetHandoffToolDetection("agent-handoff");
  await detectHandoffToolsFor("p");

  expect(api.detectHandoffTools).toHaveBeenCalledTimes(2);
});

it("does not keep a detection that was running when the plugin's was forgotten", async () => {
  let answer!: (value: { tools: { id: string; available: boolean }[] }) => void;
  vi.mocked(api.detectHandoffTools).mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const stale = detectHandoffToolsFor("p");
  forgetHandoffToolDetection("agent-handoff");
  // The ask after the forget doesn't wait on the old pick's detection.
  await detectHandoffToolsFor("p");
  expect(api.detectHandoffTools).toHaveBeenCalledTimes(2);

  answer({ tools: [{ id: "t3", available: false }] });
  await stale;

  expect(
    getHandoffTools().find((tool) => tool.toolId === "t3")?.available,
  ).toBe(true);
  await detectHandoffToolsFor("p");
  expect(api.detectHandoffTools).toHaveBeenCalledTimes(2);
});

it("lists and detects only the tools that are on, and leads to the switches while none is", async () => {
  cachePluginsOverview(handoffOverview({ enabled: [] }));
  expect(getHandoffTools()).toEqual([]);
  await detectHandoffToolsFor("p");
  expect(api.detectHandoffTools).not.toHaveBeenCalled();
  expect(getHandoffToolsChoiceNow()).toEqual({
    page: "plugins/agent-handoff",
    search: { section: "handoff-tools" },
  });

  cachePluginsOverview(handoffOverview({ enabled: ["claude"] }));
  expect(getHandoffTools().map((tool) => tool.toolId)).toEqual(["claude"]);
  expect(getHandoffToolsChoiceNow()).toBeUndefined();
  await detectHandoffToolsFor("p");
  expect(api.detectHandoffTools).toHaveBeenCalledTimes(1);
});

it("forgets the plugin's last answer with its detection, so a tool just turned on isn't read as missing", async () => {
  cachePluginsOverview(handoffOverview({ enabled: ["t3"] }));
  await detectHandoffToolsFor("p");
  cachePluginsOverview(handoffOverview({ enabled: ["t3", "claude"] }));
  forgetHandoffToolDetection("agent-handoff");
  expect(
    getHandoffTools().map((tool) => [tool.toolId, tool.available]),
  ).toEqual([
    ["t3", undefined],
    ["claude", undefined],
  ]);
});
