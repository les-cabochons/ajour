// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import {
  UnsignedProcessSwitch,
  PluginProcessAcceptance,
} from "./plugin-process-gates";
installDomShims();
afterEach(cleanup);
it("Given Settings Plugins, the process switch starts off and saves a change", async () => {
  const saved: boolean[] = [];
  function Page() {
    const [enabled, setEnabled] = useState(false);
    return (
      <UnsignedProcessSwitch
        enabled={enabled}
        disabled={false}
        onChange={(v) => {
          saved.push(v);
          setEnabled(v);
        }}
      />
    );
  }
  await renderRoutes({ routes: { "/": Page } });
  const control = screen.getByRole("switch", {
    name: "Unsigned plugins can start processes",
  });
  expect(control.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(control);
  expect(saved).toEqual([true]);
  expect(control.getAttribute("aria-checked")).toBe("true");
});
it("Given an unsigned plugin, explicit acceptance saves and Access shows its gate reason", async () => {
  const saved: boolean[] = [];
  function Page() {
    const [accepted, setAccepted] = useState(false);
    return (
      <PluginProcessAcceptance
        gate={{
          required: true,
          accepted,
          packageKey: "1",
          reason: accepted ? undefined : "process_acceptance_required",
        }}
        disabled={false}
        onChange={(v) => {
          saved.push(v);
          setAccepted(v);
        }}
      />
    );
  }
  await renderRoutes({ routes: { "/": Page } });
  expect(
    screen.getByText("Allow this plugin to start processes on its page"),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Allow this plugin to start processes",
    }),
  );
  expect(saved).toEqual([true]);
  expect(screen.getByText("Process access allowed.")).toBeTruthy();
});

it.each([
  [
    "unsigned_processes_off",
    true,
    "Turn on Unsigned plugins can start processes in Settings › Plugins",
  ],
  [undefined, false, "Signed plugin. No unsigned process gates required."],
] as const)(
  "Given gate %s, Access shows the broker state",
  async (reason, required, message) => {
    await renderRoutes({
      routes: {
        "/": () => (
          <PluginProcessAcceptance
            gate={{ required, accepted: false, packageKey: "1", reason }}
            disabled={false}
            onChange={() => {}}
          />
        ),
      },
    });
    expect(screen.getByText(message)).toBeTruthy();
    if (!required) expect(screen.queryByRole("checkbox")).toBeNull();
  },
);
