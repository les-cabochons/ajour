import { webcrypto } from "node:crypto";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rendererContext,
  replaceEventSink,
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
});
