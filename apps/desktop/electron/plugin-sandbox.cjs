// @ts-check

/**
 * When plugins stay off because this computer can't run them in a sandbox,
 * decided in #231: there is no override. Each answer is `{ cause, reason }`,
 * `cause` for the `plugin_sandbox.check` event and `reason` in words for the
 * Plugins page, or undefined when nothing stops plugins.
 *
 * @typedef {"launch_flag" | "debugger" | "environment" | "unsupported_os" | "renderer_not_sandboxed" | "renderer_integrity" | "renderer_unknown" | "shared_process"} SandboxRefusalCause
 * @typedef {{ cause: SandboxRefusalCause, reason: string }} SandboxRefusal
 */

/** The systems Ajour sandboxes plugins on. Linux stays fail-closed (#381). */
const SANDBOXED_PLATFORMS = new Set(["win32", "darwin"]);

/**
 * Command-line switches that turn the sandbox off or open the app to a
 * debugger, by their Chromium or Node name. `inspect` covers `--inspect-brk`,
 * `--inspect-port` and `--inspect-wait` too.
 */
const REFUSED_SWITCHES = [
  { name: "no-sandbox", cause: "launch_flag" },
  { name: "disable-gpu-sandbox", cause: "launch_flag" },
  { name: "single-process", cause: "launch_flag" },
  { name: "remote-debugging-port", cause: "debugger" },
  { name: "remote-debugging-pipe", cause: "debugger" },
  { name: "inspect", cause: "debugger" },
  { name: "inspect-brk", cause: "debugger" },
  { name: "inspect-port", cause: "debugger" },
  { name: "inspect-wait", cause: "debugger" },
];

/**
 * The launch's refusal: a switch on the command line or set by code, the
 * environment variable that turns the sandbox off, an inspector attached to
 * the main process, or a system Ajour doesn't sandbox plugins on.
 *
 * @param {{
 *   argv: readonly string[],
 *   hasSwitch: (name: string) => boolean,
 *   env: Record<string, string | undefined>,
 *   platform: string,
 *   inspectorActive: boolean,
 * }} launch
 * @returns {SandboxRefusal | undefined}
 */
function launchSandboxRefusal({
  argv,
  hasSwitch,
  env,
  platform,
  inspectorActive,
}) {
  for (const { name, cause } of REFUSED_SWITCHES) {
    const given = argv.some(
      (argument) =>
        argument === `--${name}` || argument.startsWith(`--${name}=`),
    );
    if (given || hasSwitch(name)) {
      return {
        cause: /** @type {SandboxRefusalCause} */ (cause),
        reason: `Ajour was started with --${name}.`,
      };
    }
  }
  if (env.ELECTRON_DISABLE_SANDBOX !== undefined) {
    return {
      cause: "environment",
      reason: "The ELECTRON_DISABLE_SANDBOX environment variable is set.",
    };
  }
  if (inspectorActive) {
    return { cause: "debugger", reason: "A debugger is attached to Ajour." };
  }
  if (!SANDBOXED_PLATFORMS.has(platform)) {
    return {
      cause: "unsupported_os",
      reason: "Plugins run only on Windows and macOS.",
    };
  }
  return undefined;
}

/**
 * The refusal for one plugin renderer, from the process's own report in
 * `app.getAppMetrics()`, read after Ajour's page loaded and before any
 * plugin code runs. It must say `sandboxed`, and on Windows run at
 * `untrusted` integrity. A process another plugin's renderer runs in is
 * refused too: each plugin has a process of its own.
 *
 * @param {{
 *   pid: number,
 *   metrics: readonly { pid: number, sandboxed?: boolean, integrityLevel?: string }[],
 *   platform: string,
 *   otherPluginPids: readonly number[],
 * }} renderer
 * @returns {SandboxRefusal | undefined}
 */
function rendererSandboxRefusal({ pid, metrics, platform, otherPluginPids }) {
  const metric = metrics.find((candidate) => candidate.pid === pid);
  if (!metric || !Number.isInteger(pid) || pid <= 0) {
    return {
      cause: "renderer_unknown",
      reason: "Ajour couldn't find a plugin's process to check its sandbox.",
    };
  }
  if (metric.sandboxed !== true) {
    return {
      cause: "renderer_not_sandboxed",
      reason: "A plugin's process isn't sandboxed.",
    };
  }
  if (platform === "win32" && metric.integrityLevel !== "untrusted") {
    return {
      cause: "renderer_integrity",
      reason: "A plugin's process doesn't run at untrusted integrity.",
    };
  }
  if (otherPluginPids.includes(pid)) {
    return {
      cause: "shared_process",
      reason: "Two plugins share a process.",
    };
  }
  return undefined;
}

module.exports = {
  launchSandboxRefusal,
  rendererSandboxRefusal,
};
