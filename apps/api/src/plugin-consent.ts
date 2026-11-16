import type { BrokerCaller } from "./broker-port.ts";
import type { AppApiStorage } from "./storage.ts";
import { summarizePluginAccess } from "../../../packages/shared/plugin-access.ts";
import {
  NO_PLUGIN_ACCESS,
  pluginAccessDifference,
  widensAccess,
  type PluginAccessSummary,
} from "../../../packages/shared/plugin-access.ts";
import type { PluginConsent } from "../../../packages/shared/plugin-access-schemas.ts";

/**
 * What an update does to a plugin's activation (#394). Turning a plugin on is
 * the user's consent to what it reaches; an update that reaches more than
 * they allowed installs off, until they allow it. Declared commands and URL
 * schemes use this same gate, including changes to a command's policy.
 */
export interface UpdateConsentDecision {
  /** The update reaches more than was allowed: the plugin stays off. */
  turnOff: boolean;
  /** What to record as allowed, when it changes. */
  record?: PluginConsent;
}

/**
 * Decides an update against what the user allowed. Without a record, a
 * plugin that was on is taken to have been allowed what its previous version
 * reached, as those turned on before Ajour recorded consent: nothing, when
 * that version couldn't run, so the update stays off and lists everything as
 * new. A plugin the user never turned on was allowed nothing, and the update
 * leaves it off.
 */
export function decideUpdateConsent(input: {
  consent: PluginConsent | undefined;
  /** The version replaced, without access when it couldn't run. */
  previous: { version: string; access?: PluginAccessSummary } | undefined;
  /** Whether the user had the plugin on before the update. */
  wasOn: boolean;
  next: { version: string; access: PluginAccessSummary };
  at: number;
}): UpdateConsentDecision {
  const { consent, previous, wasOn, next, at } = input;
  const baseline: PluginConsent | undefined =
    consent ??
    (wasOn
      ? {
          version: previous?.version ?? "unknown",
          access: previous?.access ?? NO_PLUGIN_ACCESS,
          at,
        }
      : undefined);
  if (!baseline) return { turnOff: false };

  if (widensAccess(pluginAccessDifference(baseline.access, next.access))) {
    // An implied baseline is written, so the page can list what is new.
    return { turnOff: true, ...(consent ? {} : { record: baseline }) };
  }
  // Nothing new: a plugin left on carries its allowance to the new version.
  return {
    turnOff: false,
    ...(wasOn
      ? { record: { version: next.version, access: next.access, at } }
      : {}),
  };
}

/** Rechecked immediately before spawn, against current activation and consent. */
export async function processConsentGate(
  storage: Pick<
    AppApiStorage,
    "isPluginEnabled" | "getPluginConsent" | "getPluginProcessGate"
  >,
  caller: BrokerCaller,
  processAccess = true,
): Promise<
  | "plugin_off"
  | "needs_consent"
  | "unsigned_processes_off"
  | "process_acceptance_required"
  | "package_unverified"
  | undefined
> {
  if (
    !(await storage.isPluginEnabled(
      caller.pluginId,
      new Map([[caller.pluginId, undefined]]),
    ))
  )
    return "plugin_off";
  if (caller.packageVerificationFailed) return "package_unverified";
  const consent = await storage.getPluginConsent(caller.pluginId);
  const access = summarizePluginAccess(caller.manifest, {
    agentPrompts: Object.fromEntries(
      (caller.manifest.capabilities.agentTask?.tasks ?? []).map((t) => [
        t.id,
        "",
      ]),
    ),
  });
  if (
    !consent ||
    (access.commands ?? []).some(
      (c) =>
        !(consent.access.commands ?? []).some(
          (a) => a.id === c.id && a.policy === c.policy,
        ),
    ) ||
    (access.openSchemes ?? []).some(
      (scheme) => !(consent.access.openSchemes ?? []).includes(scheme),
    )
  )
    return "needs_consent";
  if (!processAccess) return undefined;
  return (
    await storage.getPluginProcessGate(
      caller.pluginId,
      caller.packageKey ?? caller.manifest.version,
      caller.development,
    )
  ).reason;
}
