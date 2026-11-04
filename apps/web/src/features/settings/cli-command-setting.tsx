import { useEffect, useState } from "react";
import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { DisabledReason } from "@/components/disabled-reason";
import { Button } from "@/components/ui/button";
import type { DesktopCliCommandState } from "@/lib/desktop-bridge";
import { traceCarrier } from "@/lib/wide-events";

const GUIDE_URL = "https://docs.ajour.day/terminal/";
const DEVELOPMENT_REASON = "The ajour command installs from released builds.";

/** What the status line says in each state. */
function statusLine(state: DesktopCliCommandState) {
  if (state.status === "installing") {
    if (state.phase === "checking") return "Checking ajour…";
    if (state.phase === "linking") return "Adding ajour to your PATH…";
    return `Downloading ajour, ${state.progress ?? 0}%`;
  }
  if (state.status === "unsupported") {
    return `${DEVELOPMENT_REASON} From source, run: just cli`;
  }
  if (state.version) return `ajour ${state.version} · ${state.location ?? ""}`;
  return "Not installed.";
}

/**
 * Settings › General › Terminal › "ajour command" (#568, spec #567). Main's
 * controller (`apps/desktop/electron/cli-command.cjs`) does the install and
 * pushes each change; the row shows what it reports, and the reason of a
 * failed install next to it, never in a toast. The browser build, and a
 * system Ajour doesn't install it on yet, have no such section.
 */
export function CliCommandSetting() {
  const desktop = window.ajourDesktop;
  const supported = Boolean(
    desktop?.getCliCommand &&
    desktop.installCliCommand &&
    desktop.onCliCommandChanged,
  );
  const [state, setState] = useState<DesktopCliCommandState | null>(null);
  /** Why main refused the last install call, or didn't answer the read. */
  const [refused, setRefused] = useState<string | null>(null);
  /** From the click until main reports the install, so a second click does nothing. */
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let pushed = false;
    let active = true;
    const stop = desktop!.onCliCommandChanged!((next) => {
      pushed = true;
      setState(next);
    });
    desktop!.getCliCommand!(traceCarrier())
      .then((next) => {
        // A change pushed meanwhile is newer.
        if (active && !pushed) setState(next);
      })
      .catch((error: unknown) => {
        if (active) setRefused(messageOf(error));
      });
    return () => {
      active = false;
      stop();
    };
  }, [desktop, supported]);

  if (!supported) return null;
  if (state?.status === "unsupported" && state.reason !== "development_build") {
    return null;
  }

  const installing = starting || state?.status === "installing";
  const development = state?.status === "unsupported";
  const installed = state?.status === "installed";
  const error = state?.error ?? refused;

  function install() {
    if (installing || development) return;
    setStarting(true);
    setRefused(null);
    desktop!.installCliCommand!(traceCarrier())
      .then(setState, (failure: unknown) => setRefused(messageOf(failure)))
      .finally(() => setStarting(false));
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Terminal</h2>
      <p className="settings-section-desc">
        Use Ajour from your shell with the ajour command.
      </p>
      <AppPanel>
        <SettingRow
          label="ajour command"
          description={
            // Two lines at most, so a state change never moves the page.
            <span className="flex min-h-9 flex-col">
              <span role="status" className="break-words">
                {state ? (
                  <>
                    {statusLine(state)}
                    {installed && state.newlyInstalled ? (
                      <span className="block">
                        Open a new terminal to use it.
                      </span>
                    ) : null}
                  </>
                ) : null}
              </span>
              {error && !installing ? (
                <span
                  role="alert"
                  className="block break-words text-destructive"
                >
                  {error}
                </span>
              ) : null}
            </span>
          }
        >
          {installed ? (
            <a
              href={GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              How to use it
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : (
            <DisabledReason
              label="Install"
              reason={development ? DEVELOPMENT_REASON : undefined}
            >
              <Button
                variant="outline"
                disabled={!state || installing || development}
                onClick={install}
              >
                Install
              </Button>
            </DisabledReason>
          )}
        </SettingRow>
      </AppPanel>
    </section>
  );
}

function messageOf(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Ajour couldn't install the ajour command.";
}
