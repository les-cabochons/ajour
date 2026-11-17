import { afterEach, expect, it } from "vitest";
import type { Handoff } from "../../../packages/shared/handoffs.ts";
import { createHookToken, HandoffHooks } from "./handoff-hooks.ts";

const { token, tokenHash } = createHookToken();
const record = { id: "h", state: "working", changedAt: 0 } as Handoff;

let hooks: HandoffHooks | undefined;
afterEach(() => hooks?.close());

function setup(refresh: () => Promise<unknown>) {
  let reads = 0;
  hooks = new HandoffHooks({
    find: async (id) => (id === "h" ? { record, tokenHash } : undefined),
    revoke: async () => {},
    refresh: async () => {
      reads += 1;
      await refresh();
    },
    now: () => 1_000,
    debounceMs: 5,
  });
  return { hooks, reads: () => reads };
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

it("a post during a refresh makes exactly one more refresh after it", async () => {
  let finish!: () => void;
  const { hooks, reads } = setup(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );

  expect((await hooks.receive("h", token)).result).toBe("accepted");
  await settle();
  expect(reads()).toBe(1);

  expect((await hooks.receive("h", token)).result).toBe("accepted");
  expect((await hooks.receive("h", token)).result).toBe("accepted");
  await settle();
  expect(reads()).toBe(1);

  finish();
  await settle();
  expect(reads()).toBe(2);
  finish();
  await settle();
  expect(reads()).toBe(2);
});

it("forgetting a handoff before its debounce fires makes no refresh", async () => {
  const { hooks, reads } = setup(async () => {});

  expect((await hooks.receive("h", token)).result).toBe("accepted");
  hooks.forget("h");
  await settle();
  expect(reads()).toBe(0);
});
