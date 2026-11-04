// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims } from "@/test-support/dom";

/*
 * Settings › General › Desktop app (#534): the switch runs one operation at a
 * time (loading, idle, saving, reconciling, unavailable) and shows only what
 * main answered. It takes a click in `idle` and nowhere else. A read that
 * main does not answer leaves it `unavailable`, with Retry, never `idle`.
 */

const mocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast")>()),
  showErrorToast: mocks.error,
}));

const { KeepRunningSetting } =
  await import("@/features/settings/keep-running-setting");

type Settings = { keepRunning: boolean };

function deferred() {
  let resolve!: (settings: Settings) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Settings>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Pending reads and saves, answered by the test in the order they began. */
function desktop() {
  const reads: Array<ReturnType<typeof deferred>> = [];
  const saves: Array<ReturnType<typeof deferred>> = [];
  const getWindowSettings = vi.fn(() => {
    const read = deferred();
    reads.push(read);
    return read.promise;
  });
  const configureWindowSettings = vi.fn((_settings: Settings) => {
    const save = deferred();
    saves.push(save);
    return save.promise;
  });
  window.ajourDesktop = {
    getWindowSettings,
    configureWindowSettings,
  } as never;
  return { reads, saves, getWindowSettings, configureWindowSettings };
}

async function elapse(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function mount() {
  render(<KeepRunningSetting />);
  return screen.getByRole("switch", {
    name: "Keep Ajour running when the window closes",
  });
}

/** Mounts the switch and answers its first read. */
async function loadedSwitch(
  main: ReturnType<typeof desktop>,
  keepRunning = true,
) {
  const toggle = mount();
  await act(async () => main.reads[0]!.resolve({ keepRunning }));
  return toggle;
}

const disabled = (toggle: HTMLElement) => toggle.hasAttribute("data-disabled");
const shown = (toggle: HTMLElement) => toggle.getAttribute("aria-checked");

describe("the keep running setting", () => {
  beforeEach(() => {
    installDomShims();
    vi.useFakeTimers();
    mocks.error.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete window.ajourDesktop;
  });

  it("is absent without the desktop app", () => {
    render(<KeepRunningSetting />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("is disabled while loading and then shows what main holds", async () => {
    const main = desktop();
    const toggle = mount();
    expect(disabled(toggle)).toBe(true);

    await act(async () => main.reads[0]!.resolve({ keepRunning: false }));

    expect(disabled(toggle)).toBe(false);
    expect(shown(toggle)).toBe("false");
  });

  // Round 6: an unchecked, disabled switch reads as a confirmed "off".
  it("says it is reading the setting while the first read runs", async () => {
    const main = desktop();
    const toggle = mount();

    expect(disabled(toggle)).toBe(true);
    expect(screen.getByText("Reading the setting…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    const described = toggle.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    expect(document.getElementById(described!)?.textContent).toBe(
      "Reading the setting…",
    );

    await act(async () => main.reads[0]!.resolve({ keepRunning: true }));

    expect(screen.queryByText("Reading the setting…")).toBeNull();
    expect(toggle.hasAttribute("aria-describedby")).toBe(false);
    expect(shown(toggle)).toBe("true");
  });

  it("is unavailable, claiming no value, when the first read fails", async () => {
    const main = desktop();
    const toggle = mount();

    await act(async () => main.reads[0]!.reject(new Error("no answer")));

    expect(disabled(toggle)).toBe(true);
    expect(shown(toggle)).toBe("false");
    expect(screen.getByText("Ajour didn't answer.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // The row says it; no toast.
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("gives the unavailable switch its state as an accessible description", async () => {
    const main = desktop();
    const toggle = mount();

    await act(async () => main.reads[0]!.reject(new Error("no answer")));

    const described = toggle.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    expect(document.getElementById(described!)?.textContent).toBe(
      "Ajour didn't answer.",
    );
  });

  // Round 5: main holds off and answers late. The switch must not become
  // enabled on the default `on`.
  it("is unavailable, never idle, when the first read misses its deadline", async () => {
    const main = desktop();
    const toggle = mount();

    await elapse(4_900);
    expect(disabled(toggle)).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await elapse(200);

    expect(disabled(toggle)).toBe(true);
    expect(shown(toggle)).toBe("false");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(main.getWindowSettings).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    // The late answer is ignored; Retry is the way back.
    await act(async () => main.reads[0]!.resolve({ keepRunning: false }));
    expect(disabled(toggle)).toBe(true);
    expect(shown(toggle)).toBe("false");
  });

  it("Retry reads again and goes idle on main's answer", async () => {
    const main = desktop();
    const toggle = mount();
    await elapse(5_000);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(main.getWindowSettings).toHaveBeenCalledTimes(2);
    expect(disabled(toggle)).toBe(true);
    // A second click while the retry runs starts nothing.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(main.getWindowSettings).toHaveBeenCalledTimes(2);

    await act(async () => main.reads[1]!.resolve({ keepRunning: false }));

    expect(disabled(toggle)).toBe(false);
    expect(shown(toggle)).toBe("false");
    expect(screen.queryByText("Ajour didn't answer.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(toggle.hasAttribute("aria-describedby")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Retry that fails or misses its deadline is unavailable again", async () => {
    const main = desktop();
    const toggle = mount();
    await elapse(5_000);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => main.reads[1]!.reject(new Error("unreachable")));
    expect(disabled(toggle)).toBe(true);
    expect(screen.getByText("Ajour didn't answer.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await elapse(5_000);
    expect(disabled(toggle)).toBe(true);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => main.reads[3]!.resolve({ keepRunning: true }));
    expect(disabled(toggle)).toBe(false);
    expect(shown(toggle)).toBe("true");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("shows the requested value while saving, then main's answer", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);

    expect(main.configureWindowSettings).toHaveBeenCalledWith({
      keepRunning: false,
    });
    expect(shown(toggle)).toBe("false");
    expect(disabled(toggle)).toBe(true);
    // No click starts a second operation.
    fireEvent.click(toggle);
    expect(main.configureWindowSettings).toHaveBeenCalledOnce();

    await act(async () => main.saves[0]!.resolve({ keepRunning: false }));

    expect(disabled(toggle)).toBe(false);
    expect(shown(toggle)).toBe("false");
    expect(mocks.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows main's answer even when it differs from the request", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);
    await act(async () => main.saves[0]!.resolve({ keepRunning: true }));

    expect(shown(toggle)).toBe("true");
    expect(disabled(toggle)).toBe(false);
  });

  // Main may have stored the value before the save failed.
  it("reconciles a failed save to the value main holds", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);
    await act(async () =>
      main.saves[0]!.reject(
        new Error("Ajour could not write to its data folder."),
      ),
    );

    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith({
      title: "The setting was not saved.",
      description: "Ajour could not write to its data folder.",
    });
    // Reconciling shows the last confirmed value and takes no click.
    expect(shown(toggle)).toBe("true");
    expect(disabled(toggle)).toBe(true);
    fireEvent.click(toggle);
    expect(main.configureWindowSettings).toHaveBeenCalledOnce();

    await act(async () => main.reads[1]!.resolve({ keepRunning: false }));

    expect(shown(toggle)).toBe("false");
    expect(disabled(toggle)).toBe(false);
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows the last confirmed value when a failed save changed nothing", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);
    await act(async () => main.saves[0]!.reject(new Error("refused")));
    await act(async () => main.reads[1]!.resolve({ keepRunning: true }));

    expect(shown(toggle)).toBe("true");
    expect(disabled(toggle)).toBe(false);
  });

  it("recovers from a save that never answers: toast, reconcile, idle", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);
    await elapse(4_900);
    expect(disabled(toggle)).toBe(true);
    expect(shown(toggle)).toBe("false");
    expect(mocks.error).not.toHaveBeenCalled();

    await elapse(200);

    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith({
      title: "The setting was not saved.",
      description: "Ajour did not answer in time.",
    });
    expect(shown(toggle)).toBe("true");
    expect(disabled(toggle)).toBe(true);
    expect(main.getWindowSettings).toHaveBeenCalledTimes(2);

    await act(async () => main.reads[1]!.resolve({ keepRunning: false }));

    expect(shown(toggle)).toBe("false");
    expect(disabled(toggle)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Round 4: main saved false but answered late. The user must not be able to
  // start a second save before the re-read confirms false.
  it("ends on false when main answers a save after the deadline and the re-read confirms it", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);
    await elapse(5_000);
    expect(shown(toggle)).toBe("true");
    expect(disabled(toggle)).toBe(true);

    // The user clicks while the re-read is pending: nothing starts.
    fireEvent.click(toggle);
    expect(main.configureWindowSettings).toHaveBeenCalledOnce();

    // The late save answer changes nothing.
    await act(async () => main.saves[0]!.resolve({ keepRunning: false }));
    expect(shown(toggle)).toBe("true");
    expect(disabled(toggle)).toBe(true);

    await act(async () => main.reads[1]!.resolve({ keepRunning: false }));

    expect(shown(toggle)).toBe("false");
    expect(disabled(toggle)).toBe(false);
    expect(main.configureWindowSettings).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it("ignores a save that fails after its deadline", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);
    await elapse(5_000);
    await act(async () => main.saves[0]!.reject(new Error("too late")));

    expect(mocks.error).toHaveBeenCalledOnce();
    expect(main.getWindowSettings).toHaveBeenCalledTimes(2);
    expect(disabled(toggle)).toBe(true);
  });

  it("can save again once the re-read answers", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);
    await elapse(5_000);
    await act(async () => main.reads[1]!.resolve({ keepRunning: true }));
    expect(disabled(toggle)).toBe(false);

    fireEvent.click(toggle);

    expect(main.configureWindowSettings).toHaveBeenCalledTimes(2);
    expect(shown(toggle)).toBe("false");
  });

  // Round 5: the save landed in main, but neither its answer nor the re-read
  // came. The last confirmed `on` is no longer known to be true.
  it("is unavailable, never idle on the old value, when the save and the re-read both miss their deadlines", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);

    fireEvent.click(toggle);
    await elapse(5_000);
    expect(shown(toggle)).toBe("true");
    expect(disabled(toggle)).toBe(true);
    await elapse(4_900);
    expect(disabled(toggle)).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    await elapse(200);

    expect(disabled(toggle)).toBe(true);
    expect(shown(toggle)).toBe("false");
    expect(screen.getByText("Ajour didn't answer.")).toBeTruthy();
    // The save's toast only, none for the re-read.
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    // Late answers are ignored; Retry is the way back.
    await act(async () => main.saves[0]!.resolve({ keepRunning: false }));
    await act(async () => main.reads[1]!.resolve({ keepRunning: true }));
    expect(disabled(toggle)).toBe(true);
    expect(shown(toggle)).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => main.reads[2]!.resolve({ keepRunning: false }));

    expect(disabled(toggle)).toBe(false);
    expect(shown(toggle)).toBe("false");
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it("is unavailable when the re-read fails", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main, false);

    fireEvent.click(toggle);
    await act(async () => main.saves[0]!.reject(new Error("refused")));
    await act(async () => main.reads[1]!.reject(new Error("unreachable")));

    expect(disabled(toggle)).toBe(true);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it("leaves no timer and no update when it unmounts while unavailable", async () => {
    const main = desktop();
    mount();
    await elapse(5_000);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => main.reads[0]!.resolve({ keepRunning: false }));
    await elapse(10_000);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(main.getWindowSettings).toHaveBeenCalledOnce();
  });

  it("leaves no timer and no update when it unmounts during a retry", async () => {
    const main = desktop();
    mount();
    await elapse(5_000);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => main.reads[1]!.reject(new Error("unreachable")));
    await elapse(10_000);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(main.getWindowSettings).toHaveBeenCalledTimes(2);
  });

  it("is disabled in every state but idle", async () => {
    const main = desktop();
    const states: boolean[] = [];
    const toggle = mount();
    states.push(disabled(toggle)); // loading
    await act(async () => main.reads[0]!.resolve({ keepRunning: true }));
    expect(disabled(toggle)).toBe(false); // idle

    fireEvent.click(toggle);
    states.push(disabled(toggle)); // saving
    await act(async () => main.saves[0]!.reject(new Error("refused")));
    states.push(disabled(toggle)); // reconciling
    await act(async () => main.reads[1]!.resolve({ keepRunning: true }));
    expect(disabled(toggle)).toBe(false); // idle again

    expect(states).toEqual([true, true, true]);
  });

  it("leaves no timer and no update when it unmounts while loading", async () => {
    const main = desktop();
    mount();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => main.reads[0]!.resolve({ keepRunning: false }));
    await elapse(10_000);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("leaves no timer and no toast when it unmounts mid-save", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);
    fireEvent.click(toggle);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => main.saves[0]!.reject(new Error("refused")));
    await elapse(10_000);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(main.getWindowSettings).toHaveBeenCalledOnce();
  });

  it("leaves no timer and no second toast when it unmounts mid-reconcile", async () => {
    const main = desktop();
    const toggle = await loadedSwitch(main);
    fireEvent.click(toggle);
    await act(async () => main.saves[0]!.reject(new Error("refused")));
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => main.reads[1]!.reject(new Error("unreachable")));
    await elapse(10_000);
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});
