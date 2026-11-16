import { expect, it, vi, afterEach } from "vitest";
import { CommandAsks } from "./command-asks.ts";
afterEach(() => vi.useRealTimers());
const ask = {
  executable: "git",
  argv: ["--version"],
  pluginId: "p",
  pluginName: "Plugin",
  folderName: "System root",
  risky: false,
};
it("Given no window, an ask is denied with a reason", async () => {
  const asks = new CommandAsks({ connected: () => false, publish: () => {} });
  expect(await asks.ask(ask, new AbortController().signal)).toEqual({
    answer: "deny",
    reason: "no_window",
  });
});
it("Given queued asks, only one appears, and each times out to Deny", async () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const asks = new CommandAsks({ connected: () => true, publish });
  const one = asks.ask(ask, new AbortController().signal);
  const two = asks.ask(ask, new AbortController().signal);
  expect(publish).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120000);
  expect(await one).toEqual({ answer: "deny", reason: "ask_timeout" });
  expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ executable: "git" });
  await vi.advanceTimersByTimeAsync(120000);
  expect(await two).toEqual({ answer: "deny", reason: "ask_timeout" });
});

it("Given queued asks, stale answers cannot allow the next command", async () => {
  const published: Array<
    import("../../../packages/shared/command-modes.ts").CommandAsk | null
  > = [];
  const asks = new CommandAsks({
    connected: () => true,
    publish: (ask) => published.push(ask),
  });
  const one = asks.ask(ask, new AbortController().signal);
  const controller = new AbortController();
  const two = asks.ask(ask, controller.signal);
  const first = published.at(-1)!;
  expect(asks.answer("unknown", "once")).toBe(false);
  expect(asks.answer(first.id, "once")).toBe(true);
  expect(await one).toEqual({ answer: "once" });
  expect(asks.answer(first.id, "always")).toBe(false);
  controller.abort();
  expect(await two).toEqual({ answer: "deny", reason: "operation_ended" });
  expect(asks.snapshot()).toBeNull();
});
it("Given a window that disconnects, all outstanding asks deny", async () => {
  let connected = true;
  const asks = new CommandAsks({
    connected: () => connected,
    publish: () => {},
  });
  const one = asks.ask(ask, new AbortController().signal);
  const two = asks.ask(ask, new AbortController().signal);
  connected = false;
  asks.disconnect();
  expect(await one).toEqual({ answer: "deny", reason: "no_window" });
  expect(await two).toEqual({ answer: "deny", reason: "no_window" });
  expect(asks.snapshot()).toBeNull();
});
