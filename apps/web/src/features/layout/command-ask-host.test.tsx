// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { CommandAskHost } from "./command-ask-dialog";
const { answerCommand } = vi.hoisted(() => ({ answerCommand: vi.fn() }));
vi.mock("@/lib/app-api", () => ({
  answerCommand,
  appApiUrl: (p: string) => p,
  postMcpBridgeResult: vi.fn(),
}));
installDomShims();
class Stream {
  static CLOSED = 2;
  static instances: Stream[] = [];
  readyState = 1;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  listeners = new Map<string, (e: { data: string }) => void>();
  close = vi.fn();
  constructor(readonly url: string) {
    Stream.instances.push(this);
  }
  addEventListener(name: string, fn: (e: { data: string }) => void) {
    this.listeners.set(name, fn);
  }
  send(ask: unknown) {
    this.listeners.get("command-ask")?.({ data: JSON.stringify(ask) });
  }
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("Given a routed ask stream, delays approval, shows answer errors inside the dialog, clears them on next ask and reconnects", async () => {
  vi.stubGlobal("EventSource", Stream);
  Stream.instances = [];
  answerCommand
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ answered: true });
  await renderRoutes({ routes: { "/": CommandAskHost } });
  vi.useFakeTimers();
  const stream = Stream.instances[0]!;
  expect(stream.url).toContain("/api/process/bridge");
  const ask = {
    id: "one",
    pluginId: "p",
    pluginName: "Tool",
    signed: true,
    executable: "git",
    argv: ["a\u00a0b"],
    folderName: "Repo",
    folderPath: "C:/repo",
    resolvedExecutable: "C:/git.exe",
    risky: false,
    expiresAt: Date.now() + 120000,
  };
  await act(async () => stream.send(ask));
  expect(screen.getByText("Plugin: p, Signed")).toBeTruthy();
  expect(
    screen.getByLabelText("Exact command arguments").textContent,
  ).toContain("\\u{A0}");
  expect(
    (screen.getByRole("button", { name: "Allow once" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(600));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Allow once" })),
  );
  expect(answerCommand).toHaveBeenCalledWith("one", "once");
  expect(screen.getByRole("dialog").contains(screen.getByRole("alert"))).toBe(
    true,
  );
  await act(async () => stream.send({ ...ask, id: "two" }));
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Deny all from this plugin" }),
    ),
  );
  expect(answerCommand).toHaveBeenLastCalledWith("two", "deny-all");
  await act(async () => {
    stream.readyState = Stream.CLOSED;
    stream.onerror?.();
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(Stream.instances).toHaveLength(2);
  await act(async () => Stream.instances[1]!.send({ ...ask, id: "three" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  cleanup();
  expect(Stream.instances[1]!.close).toHaveBeenCalled();
});
