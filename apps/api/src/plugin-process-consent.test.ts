import { describe, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { summarizePluginAccess } from "../../../packages/shared/plugin-access.ts";
import { pluginConsentSchema } from "../../../packages/shared/plugin-access-schemas.ts";
import { decideUpdateConsent } from "./plugin-consent.ts";

const base = {
  id: "process-test",
  version: "1.0.0",
  apiVersion: 4,
  displayName: "Process test",
  iconSvg: "<svg />",
  entrypoint: "plugin.mjs",
  connectionFields: [{ id: "url", label: "URL", type: "url" }],
  capabilities: { connector: {} },
};
function access(processes?: unknown) {
  return summarizePluginAccess(
    pluginApi4ManifestSchema.parse({
      ...base,
      ...(processes ? { processes } : {}),
    }),
    { agentPrompts: {} },
  );
}
const declaration = {
  executables: { t3: { names: ["t3"] } },
  commands: [
    {
      id: "start",
      executable: "t3",
      args: ["thread", "start", "{title:text}"],
      mode: "capture",
      timeoutSeconds: 60,
    },
  ],
  openSchemes: ["codex"],
};
function decision(
  previous: ReturnType<typeof access>,
  next: ReturnType<typeof access>,
) {
  return decideUpdateConsent({
    consent: { version: "1", at: 1, access: previous },
    previous: { version: "1", access: previous },
    wasOn: true,
    next: { version: "2", access: next },
    at: 2,
  });
}
describe("process access update consent", () => {
  it.each([
    ["command", { ...declaration, openSchemes: [] }],
    ["scheme", { openSchemes: ["codex"] }],
  ])("holds an added %s until approved again", (_, processes) => {
    expect(decision(access(), access(processes)).turnOff).toBe(true);
    expect(decision(access(processes), access(processes)).turnOff).toBe(false);
  });
  it("holds an executable name change even when the argv shape stays the same", () => {
    expect(
      decision(
        access(declaration),
        access({
          ...declaration,
          executables: { t3: { names: ["t3", "other"] } },
        }),
      ).turnOff,
    ).toBe(true);
  });
  it("allows removal without new consent", () => {
    expect(decision(access(declaration), access()).turnOff).toBe(false);
  });
});

it.each([
  { args: ["{title:text}"] },
  { mode: "detached" },
  { stdin: "text" },
  { timeoutSeconds: 600 },
  { args: [{ kind: "enum", name: "format", values: ["json", "text"] }] },
  { args: [{ if: "title", args: ["--title", "{title:text}"] }] },
])("holds a changed command policy until approved: %j", (change) => {
  expect(
    decision(
      access(declaration),
      access({
        ...declaration,
        commands: [{ ...declaration.commands[0], ...change }],
      }),
    ).turnOff,
  ).toBe(true);
});

it("keeps an old consent record and treats its missing process lists as empty", () => {
  const oldAccess = access();
  delete oldAccess.commands;
  delete oldAccess.openSchemes;
  const consent = pluginConsentSchema.parse({
    version: "1",
    at: 1,
    access: oldAccess,
  });
  expect(consent.access.commands).toEqual([]);
  expect(consent.access.openSchemes).toEqual([]);
  expect(decision(consent.access, access(declaration)).turnOff).toBe(true);
});
