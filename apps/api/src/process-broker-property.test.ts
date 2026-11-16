import { expect, it, vi } from "vitest";
import fc from "fast-check";
import { spawn } from "node:child_process";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { ProcessBroker } from "./process-broker.ts";
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
const manifest = pluginApi4ManifestSchema.parse({
  id: "property",
  version: "1.0.0",
  apiVersion: 4,
  displayName: "Property",
  entrypoint: "index.js",
  iconSvg: "<svg/>",
  connectionFields: [{ id: "site", label: "Site", type: "text" }],
  capabilities: { connector: {} },
  processes: { undeclaredCommands: true },
});
const cases = (["always-ask", "auto", "accept-everything"] as const).flatMap(
  (mode) =>
    (["none", "review", "risky"] as const).map((verdict) => ({
      mode,
      verdict,
    })),
);
it.each(cases)(
  "Property: $mode / $verdict never bypasses gates or denied and expired asks",
  async ({ mode, verdict }) => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("space value", "--flag", "a&b", ""), {
          maxLength: 4,
        }),
        async (argv) => {
          for (const gateReason of [
            undefined,
            "plugin_off",
            "needs_consent",
            "unsigned_processes_off",
            "process_acceptance_required",
            "package_unverified",
          ] as const) {
            for (const stage of [
              "upfront",
              "after-ask",
              "before-spawn",
            ] as const) {
              const asks =
                mode === "always-ask" ||
                (mode === "auto" && verdict === "risky");
              let calls = 0;
              vi.mocked(spawn).mockClear();
              const target =
                stage === "upfront"
                  ? 1
                  : stage === "after-ask" && asks
                    ? 2
                    : asks
                      ? 3
                      : 2;
              const broker = new ProcessBroker({
                folders: { resolve: async () => undefined },
                gate: async () => (++calls === target ? gateReason : undefined),
                policy: async () => ({
                  identity: "v",
                  signed: true,
                  mode,
                  approvals: [],
                }),
                review: { review: async () => ({ verdict }) },
                ask: async () => ({ answer: "once" }),
              });
              const result = broker
                .forOperation({
                  pluginId: manifest.id,
                  manifest,
                  method: "syncConnection",
                })
                .run({
                  executable: "node",
                  argv: ["-e", "process.exit(0)", "--", ...argv],
                });
              if (gateReason) {
                await expect(result).rejects.toMatchObject({
                  reason: gateReason,
                });
                expect(spawn).not.toHaveBeenCalled();
              } else {
                await result;
                expect(spawn).toHaveBeenCalledTimes(1);
              }
              await broker.shutdown();
            }
          }
          if (mode === "always-ask" || (mode === "auto" && verdict === "risky"))
            for (const reason of [
              "user_denied",
              "ask_timeout",
              "ask_queue_full",
            ] as const) {
              vi.mocked(spawn).mockClear();
              const broker = new ProcessBroker({
                folders: { resolve: async () => undefined },
                gate: async () => undefined,
                policy: async () => ({
                  identity: "v",
                  signed: true,
                  mode,
                  approvals: [],
                }),
                review: { review: async () => ({ verdict }) },
                ask: async () => ({ answer: "deny", reason }),
              });
              await expect(
                broker
                  .forOperation({
                    pluginId: manifest.id,
                    manifest,
                    method: "syncConnection",
                  })
                  .run({ executable: "node", argv }),
              ).rejects.toMatchObject({ reason });
              expect(spawn).not.toHaveBeenCalled();
              await broker.shutdown();
            }
        },
      ),
      { numRuns: 2 },
    );
  },
  30000,
);
