import { describe, expectTypeOf, it } from "vitest";
import type { LaunchContext } from "@ajour/wide-events";
import type {} from "./desktop-bridge";

type DesktopBridge = NonNullable<Window["ajourDesktop"]>;

// Checked by `just typecheck`: the desktop main process answers a synchronous
// request that fails with null (apps/desktop/electron/ipc-listeners.cjs).
describe("desktop bridge", () => {
  it("lets every synchronous answer be null", () => {
    expectTypeOf<null>().toExtend<DesktopBridge["bootstrapLocalState"]>();
    expectTypeOf<null>().toExtend<DesktopBridge["runtime"]>();
    expectTypeOf<null>().toExtend<DesktopBridge["appMenu"]>();
  });

  // The main process makes the launch context (apps/desktop/electron/main-events.cjs).
  it("hands the renderer the main process's launch context", () => {
    expectTypeOf<
      NonNullable<DesktopBridge["runtime"]>["launch"]
    >().toEqualTypeOf<LaunchContext | undefined>();
  });
});
