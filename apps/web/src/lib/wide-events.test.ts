import { webcrypto } from "node:crypto";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runStoreCommand } from "@/lib/store-command-events";
import {
  rendererContext,
  replaceEventSink,
  withEventAttribution,
  wideEvents,
} from "@/lib/wide-events";

const desktopRuntime = {
  automaticUpdatesEnabled: true,
  developmentBuild: false,
  platform: "win32",
  version: "1.4.0",
};

describe("the renderer's runtime context", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
  });

  it("reports the launch the desktop main process hands over", () => {
    const context = rendererContext({
      ...desktopRuntime,
      launch: {
        launch_id: "launch-from-main",
        app: {
          version: "1.4.1",
          channel: "nightly",
          commit: "abc1234",
          packaged: true,
        },
        device: { platform: "darwin", arch: "arm64", electron: "38.1.0" },
      },
    });

    expect(context).toMatchObject({
      runtime: "renderer",
      launch_id: "launch-from-main",
      app: {
        version: "1.4.1",
        channel: "nightly",
        commit: "abc1234",
        packaged: true,
      },
      device: { platform: "darwin", arch: "arm64", electron: "38.1.0" },
    });
    expect(context.window_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("falls back field by field when the launch is partial or malformed", () => {
    const context = rendererContext({
      ...desktopRuntime,
      launch: {
        launch_id: 42,
        app: { version: "", channel: "beta", packaged: "yes" },
        device: { arch: "x64" },
      } as never,
    });

    expect(context.launch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.app).toEqual({
      version: "1.4.0",
      channel: "stable",
      packaged: true,
    });
    expect(context.device).toEqual({ platform: "win32", arch: "x64" });
  });

  it("makes its own launch in the web build", () => {
    const context = rendererContext(undefined);

    expect(context.launch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.app).toMatchObject({ channel: "web", packaged: false });
  });
});

describe("the renderer's error messages", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
  });

  it("leaves an error's message out, keeping its type and code, while no scrub paths are known", () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);
    const error = Object.assign(
      new Error("ENOENT: C:\\Users\\ada\\AppData\\Roaming\\Ajour\\state.json"),
      { code: "ENOENT" },
    );

    const unit = wideEvents.start("app.error", {
      kind: "crash",
      trigger: "system",
    });
    unit.fail(error);
    unit.end();

    expect(sink.events[0]!.error).toEqual({ type: "Error", code: "ENOENT" });
  });

  it("drops at runtime any field the catalog doesn't declare for the event", () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);

    wideEvents.run(
      "week.reopen",
      { kind: "command", trigger: "user" },
      (unit) =>
        unit.set({
          week: { week_of: "2026-10-05", note: "Private note" },
          extra: { secret: "y" },
        } as never),
    );

    const [event] = sink.events;
    expect(event).toMatchObject({
      name: "week.reopen",
      week: { week_of: "2026-10-05" },
    });
    expect(JSON.stringify(event)).not.toContain("Private note");
    expect(event).not.toHaveProperty("extra");
  });

  it("drops an object or a function at a declared field, and counts what it dropped", () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);

    wideEvents.run(
      "backlog_item.create",
      { kind: "command", trigger: "user" },
      (unit) =>
        unit.set({
          backlog_item: {
            id: { title: "Secret title", description: "Secret text" },
            parent_id: () => "fn",
            closed: true,
          },
          time_entry: { day: "2026-10-06" },
        } as never),
    );

    const [event] = sink.events;
    expect(event!.backlog_item).toEqual({ closed: true });
    expect(event!.counts).toEqual({ dropped_field_count: 3 });
    expect(JSON.stringify(event)).not.toContain("Secret");
  });

  it("keeps strings, numbers, booleans, null and arrays of them", () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);

    wideEvents.run(
      "preferences.update",
      { kind: "command", trigger: "user" },
      (unit) =>
        unit.set({
          preferences: {
            scope: "user",
            changed_keys: ["themeMode", "timeView"],
            values: ["themeMode=dark", { secret: "Secret" }],
          },
          store: { revision_changed: null, undo_offered: false },
        } as never),
    );

    expect(sink.events[0]).toMatchObject({
      preferences: { scope: "user", changed_keys: ["themeMode", "timeView"] },
      store: { revision_changed: null, undo_offered: false },
    });
    // An array that holds an object is dropped whole.
    expect(sink.events[0]!.preferences).not.toHaveProperty("values");
    expect(sink.events[0]!.counts).toEqual({ dropped_field_count: 1 });
  });
});

describe("dispatcher attribution", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
  });

  it("records each catalog surface and leaves an unknown source unset", () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);
    const surfaces = [
      "button",
      "popover",
      "shortcut",
      "item_key",
      "palette",
      "context_menu",
      "app_menu",
      "drag",
      "editor",
      "dialog",
      "toast",
    ] as const;

    for (const surface of surfaces) {
      withEventAttribution({ surface }, () =>
        runStoreCommand("time_entry.update", () => undefined),
      );
    }
    runStoreCommand("time_entry.update", () => undefined);

    expect(sink.events.map(({ surface }) => surface)).toEqual([
      ...surfaces,
      undefined,
    ]);
    expect(sink.events.at(-1)).toMatchObject({ trigger: "user" });
  });

  it("keeps right-click and the ellipsis menu on different surfaces", () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);
    const runCommand = () => runStoreCommand("time_entry.update", () => {});

    withEventAttribution({ surface: "context_menu" }, () =>
      withEventAttribution({ surface: "button" }, runCommand),
    );
    withEventAttribution({ surface: "button" }, runCommand);

    expect(sink.events.map(({ surface }) => surface)).toEqual([
      "context_menu",
      "button",
    ]);
  });
});
