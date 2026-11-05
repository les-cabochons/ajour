import { useEffect, useState } from "react";
import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { DisabledReason } from "@/components/disabled-reason";
import { Button } from "@/components/ui/button";
import type {
  DesktopCliCommandState,
  DesktopCliWslDistro,
} from "@/lib/desktop-bridge";
import { traceCarrier } from "@/lib/wide-events";

const GUIDE_URL = "https://docs.ajour.day/terminal/";
const DEVELOPMENT_REASON = "The ajour command installs from released builds.";

/** What the status's first line says in each state. */
function statusLine(state: DesktopCliCommandState) {
  if (state.status === "installing" && state.pending) {
    return `Updating ajour to ${state.pending}, ${state.progress ?? 0}%`;
  }
  if (state.status === "installing") {
    if (state.phase === "checking") return "Checking ajour…";
    if (state.phase === "linking") return "Adding ajour to your PATH…";
    return `Downloading ajour, ${state.progress ?? 0}%`;
  }
  if (state.status === "removing") return "Removing ajour…";
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
  const [removing, setRemoving] = useState(false);

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

  const installing =
    starting ||
    removing ||
    state?.status === "installing" ||
    state?.status === "removing";
  const development = state?.status === "unsupported";
  const installed = state?.status === "installed";
  const macos = desktop?.runtime?.platform === "darwin";
  // After Remove, `notice` names the WSL links it couldn't delete (#605).
  const errorOrNotice = state?.error ?? refused ?? state?.notice ?? null;
  const alert =
    errorOrNotice && state?.pending
      ? `ajour couldn't update to ${state.pending}: ${errorOrNotice.replace(/\.$/, "")}. The installed version keeps working.`
      : errorOrNotice;

  function remove() {
    if (installing || !desktop?.removeCliCommand) return;
    setRemoving(true);
    setRefused(null);
    desktop
      .removeCliCommand()
      .then(setState, (failure: unknown) => setRefused(messageOf(failure)))
      .finally(() => setRemoving(false));
  }

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
                    <Line
                      text={removing ? "Removing ajour…" : statusLine(state)}
                    />
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
              {alert && !installing ? (
                <Line role="alert" text={alert} className="text-destructive" />
              ) : null}
            </span>
          }
        >
          {installed && desktop?.removeCliCommand ? (
            <Button variant="outline" disabled={installing} onClick={remove}>
              Remove
            </Button>
          ) : null}
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
                onClick={state?.operation === "remove" ? remove : install}
              >
                {state?.status === "error" ? "Retry" : "Install"}
              </Button>
            </DisabledReason>
          )}
        </SettingRow>
        {/* Main reports WSL distros only on Windows x64. */}
        {state?.version && state.status !== "removing"
          ? state.wsl?.distros.map((distro) => (
              <WslRow
                key={distro.name}
                distro={distro}
                version={state.wsl?.version}
                disabled={installing}
                onChange={setState}
              />
            ))
          : null}
      </AppPanel>
    </section>
  );
}

function messageOf(
  error: unknown,
  fallback = "Ajour couldn't install the ajour command.",
) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type WslOperation = "add" | "remove";

/**
 * What a distro row is doing: an Add or Remove running, from the click on;
 * one that failed, which Retry repeats; or the distro, added or not.
 */
type WslRowMode =
  | { kind: "unsupported" }
  | { kind: "running"; operation: WslOperation }
  | { kind: "failed"; operation: WslOperation; added: boolean }
  | { kind: "idle"; added: boolean };

function wslRowMode(
  distro: DesktopCliWslDistro,
  starting: WslOperation | null,
  rejected: { operation: WslOperation } | null,
): WslRowMode {
  if (distro.status === "unsupported") return { kind: "unsupported" };
  if (starting) return { kind: "running", operation: starting };
  if (distro.status === "adding") return { kind: "running", operation: "add" };
  if (distro.status === "removing")
    return { kind: "running", operation: "remove" };
  // A failed Add of an added distro, or a failed Remove, keeps its link.
  const added =
    distro.status === "added" || (distro.status === "error" && distro.added);
  if (rejected) return { kind: "failed", operation: rejected.operation, added };
  if (distro.status === "error")
    return { kind: "failed", operation: distro.operation, added };
  return { kind: "idle", added };
}

/** The row's button, if any: Retry repeats the operation that failed. */
function wslButton(
  mode: WslRowMode,
): { operation: WslOperation; label: string } | null {
  switch (mode.kind) {
    case "unsupported":
      return null;
    case "failed":
      return { operation: mode.operation, label: "Retry" };
    case "running":
      return {
        operation: mode.operation,
        label: mode.operation === "add" ? "Add" : "Remove",
      };
    case "idle":
      return mode.added
        ? { operation: "remove", label: "Remove" }
        : { operation: "add", label: "Add" };
  }
}

/** What a distro row's status line says. */
function wslStatusLine(
  distro: DesktopCliWslDistro,
  mode: WslRowMode,
  version?: string,
) {
  if (distro.status === "unsupported") return distro.reason;
  if (mode.kind === "running" && mode.operation === "remove")
    return "Removing ajour…";
  if (mode.kind === "running") {
    // Until main reports the Add, it starts as a download does.
    const phase = distro.status === "adding" ? distro.phase : "downloading";
    if (phase === "checking") return `Checking ajour in ${distro.name}…`;
    if (phase === "linking") return "Linking ~/.local/bin/ajour…";
    const progress = distro.status === "adding" ? distro.progress : null;
    return `Downloading ajour, ${progress ?? 0}%`;
  }
  if (mode.kind !== "unsupported" && mode.added)
    return `ajour ${version ?? ""} · ~/.local/bin/ajour`;
  return "Not added.";
}

/**
 * One WSL distro under the ajour command (#604, #605): Add, its three
 * phases, the added command with the hint for a new terminal and Remove,
 * "Removing ajour…", or the reason an Add or Remove failed, inline with
 * Retry, which repeats it. A failed Add of an added distro, or a failed
 * Remove, keeps it Added, since its link still works. Remove asks for no
 * confirmation: Add restores it. Main serializes them, so each row runs
 * alone. A WSL 1 distro has no Add, only how to convert it (#611).
 */
function WslRow({
  distro,
  version,
  disabled,
  onChange,
}: {
  distro: DesktopCliWslDistro;
  version?: string;
  disabled: boolean;
  onChange: (state: DesktopCliCommandState) => void;
}) {
  /** From the click until main answers. */
  const [starting, setStarting] = useState<WslOperation | null>(null);
  /** Why main rejected the last call, and which it was. */
  const [rejected, setRejected] = useState<{
    operation: WslOperation;
    message: string;
  } | null>(null);
  const mode = wslRowMode(distro, starting, rejected);
  const busy = mode.kind === "running";
  // A Retry hides the reason it retries.
  const reason = busy
    ? null
    : (rejected?.message ?? (distro.status === "error" ? distro.error : null));
  const button = wslButton(mode);

  function run(next: WslOperation) {
    const desktop = window.ajourDesktop;
    const call =
      next === "add" ? desktop?.addCliCommandWsl : desktop?.removeCliCommandWsl;
    if (!call || busy) return;
    setStarting(next);
    setRejected(null);
    call({ distro: distro.name }, traceCarrier())
      .then(onChange, (failure: unknown) =>
        setRejected({
          operation: next,
          message: messageOf(
            failure,
            next === "add"
              ? `Ajour couldn't add ajour to ${distro.name}.`
              : `Ajour couldn't remove ajour from ${distro.name}.`,
          ),
        }),
      )
      .finally(() => setStarting(null));
  }

  return (
    <SettingRow
      label={distro.name}
      description={
        <span className="flex h-12 min-w-0 flex-col overflow-hidden">
          <span role="status">
            <Line text={wslStatusLine(distro, mode, version)} />
            {distro.status === "added" && distro.hint && !busy ? (
              <Line text={distro.hint} />
            ) : null}
          </span>
          {reason ? (
            <Line role="alert" text={reason} className="text-destructive" />
          ) : null}
        </span>
      }
    >
      {button ? (
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => run(button.operation)}
        >
          {button.label}
        </Button>
      ) : null}
    </SettingRow>
  );
}
