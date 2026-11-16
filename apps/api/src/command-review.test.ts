import fc from "fast-check";
import { expect, it } from "vitest";
import { commandDecision } from "./command-review.ts";
it.each([
  ["always-ask", "none", "ask"],
  ["always-ask", "review", "ask"],
  ["always-ask", "risky", "ask"],
  ["auto", "none", "run"],
  ["auto", "review", "run"],
  ["auto", "risky", "ask"],
  ["accept-everything", "none", "run"],
  ["accept-everything", "review", "run"],
  ["accept-everything", "risky", "run"],
] as const)(
  "Given mode %s and verdict %s, decision is %s",
  (mode, verdict, expected) => {
    expect(commandDecision(mode, verdict)).toBe(expected);
  },
);

it("Property: no verdict can turn a gate refusal or an Always ask into a run", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("none", "review", "risky"),
      fc.string(),
      fc.string(),
      fc.constantFrom(
        "plugin_off",
        "needs_consent",
        "unsigned_processes_off",
        "process_acceptance_required",
        "package_unverified",
      ),
      async (verdict, ruleId, reason, gate) => {
        expect(commandDecision("always-ask", verdict)).toBe("ask");
        const { ProcessBroker } = await import("./process-broker.ts");
        const { pluginApi4ManifestSchema } =
          await import("../../../packages/shared/plugin-api-4.ts");
        const manifest = pluginApi4ManifestSchema.parse({
          id: "test",
          version: "1.0.0",
          apiVersion: 4,
          displayName: "Test",
          iconSvg: "<svg/>",
          entrypoint: "index.js",
          connectionFields: [{ id: "site", label: "Site", type: "text" }],
          capabilities: { connector: {} },
        });
        const broker = new ProcessBroker({
          folders: { resolve: async () => undefined },
          gate: async () => gate,
          review: { review: async () => ({ verdict, ruleId, reason }) },
        });
        await expect(
          broker
            .forOperation({
              pluginId: "test",
              manifest,
              method: "syncConnection",
            })
            .run({ executable: "git", argv: [] }),
        ).rejects.toMatchObject({ reason: gate });
      },
    ),
  );
});
