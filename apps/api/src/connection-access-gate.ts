/**
 * How the local API holds a connection to its access choices (#395): an
 * operation whose choice is off is refused before the plugin runs, at the
 * route and again at the operation's gate, and a save that turns a choice
 * off cancels the operations it allowed that still run. The choices
 * themselves, and which operation each unlocks, are in
 * `packages/shared/connection-access.ts`; the broker holds an API 4
 * plugin's requests to the same choices endpoint by endpoint.
 *
 * The answer to a refused call is a 403 with `reason: "access_off"` and the
 * choice's id, so the web can hold the edit on this computer instead of
 * dropping it.
 */

import {
  accessRefusalOf,
  connectionAccessChoicesOf,
  type ConnectionAccessChoice,
} from "../../../packages/shared/connection-access.ts";
import {
  PluginOperationCancelled,
  PluginOperationRefused,
} from "./plugin-worker-lifetime.ts";

/** An operation the connection's access doesn't allow, refused or cancelled. */
export class ConnectionAccessOff extends PluginOperationRefused {
  /** The choice it needs. */
  readonly access: string;

  constructor(message: string, access: string) {
    super(message, "access_off");
    this.access = access;
  }
}

/** What the user reads when the connection's access refuses an operation. */
export function accessOffMessage(
  connection: { label: string },
  choice: Pick<ConnectionAccessChoice, "label">,
) {
  return `The "${connection.label}" connection's access doesn't include "${choice.label}". Turn it on in the connection's settings.`;
}

/**
 * The refusal of `operation` on the connection as saved, or undefined when
 * its access allows it.
 */
export function connectionAccessRefusal(
  plugin: Parameters<typeof connectionAccessChoicesOf>[0],
  connection: { label: string; access?: readonly string[] },
  operation: string,
): ConnectionAccessOff | undefined {
  const choice = accessRefusalOf(
    connectionAccessChoicesOf(plugin),
    connection.access,
    operation,
  );
  return choice
    ? new ConnectionAccessOff(accessOffMessage(connection, choice), choice.id)
    : undefined;
}

/**
 * The body of the answer to a call its connection's access stopped, before
 * it ran or while it ran, or undefined for any other failure.
 */
export function accessOffAnswer(
  error: unknown,
): { error: string; reason: "access_off"; access: string } | undefined {
  const refusal =
    error instanceof ConnectionAccessOff
      ? error
      : error instanceof PluginOperationCancelled &&
          error.cause instanceof ConnectionAccessOff
        ? error.cause
        : undefined;
  return refusal
    ? { error: refusal.message, reason: "access_off", access: refusal.access }
    : undefined;
}
