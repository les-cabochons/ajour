import { useEffect, useState } from "react";
import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { DisabledReason } from "@/components/disabled-reason";
import { Button } from "@/components/ui/button";
import type { DesktopCliCommandState } from "@/lib/desktop-bridge";
import { traceCarrier } from "@/lib/wide-events";

const GUIDE_URL = "https://docs.ajour.day/terminal/";
const DEVELOPMENT_REASON = "The ajour command installs from released builds.";

/** What the status's first line says in each state. */
function statusLine(state: DesktopCliCommandState) {
  if (state.status === "installing") {
    if (state.phase === "checking") return "Checking ajour…";
    if (state.phase === "linking") return "Adding ajour to your PATH…";
    return `Downloading ajour, ${state.progress ?? 0}%`;
  }
  if (state.status === "unsupported") return DEVELOPMENT_REASON;
  if (state.version) return `ajour ${state.version}`;
  return "Not installed.";
}

const LINE = "block h-4 truncate leading-4";

/**
 * One line of the row's description: cut with an ellipsis when it is too
 * long, its whole text in the DOM for assistive technology and in its title.
 */
function Line({
  text,
  className = "",
  role,
}: {
  text: string;
  className?: string;
  role?: "alert";
}) {
  return (
    <span data-line role={role} title={text} className={`${LINE} ${className}`}>
      {text}
    </span>
  );
}

/**
 * The install folder in mono, cut in the middle: its start gives way first,
 * and its last two folders, such as `\Ajour\bin`, always show.
 */
function FolderLine({ folder }: { folder: string }) {
  const cut = Math.max(
    0,
    folder.lastIndexOf("\\", folder.lastIndexOf("\\") - 1),
    folder.lastIndexOf("/", folder.lastIndexOf("/") - 1),
  );
  return (
    <span
      data-line
      title={folder}
      className="flex h-4 min-w-0 overflow-hidden font-mono leading-4 whitespace-nowrap"
    >
      <span className="min-w-0 truncate">{folder.slice(0, cut)}</span>
      <span className="shrink-0">{folder.slice(cut)}</span>
    </span>
  );
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
  const macos = desktop?.runtime?.platform === "darwin";
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
            // Three fixed lines, each cut to fit, so no state, version,
            // folder or error ever changes the row's height.
            <span className="flex h-12 min-w-0 flex-col overflow-hidden">
              <span role="status" className="flex min-w-0 flex-col">
                {state ? (
                  <>
                    <Line text={statusLine(state)} />
                    {development ? (
                      <Line text="From source, run: just cli" />
                    ) : state.location ? (
                      <FolderLine folder={state.location} />
                    ) : null}
                    {macos && state.status === "not-installed" ? (
                      <Line text="Asks for your password to add it to /usr/local/bin." />
                    ) : null}
                    {installed && state.newlyInstalled ? (
                      <Line text="Open a new terminal to use it." />
                    ) : null}
                  </>
                ) : null}
              </span>
              {error && !installing ? (
                <Line role="alert" text={error} className="text-destructive" />
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
                {state?.status === "error" ? "Retry" : "Install"}
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
