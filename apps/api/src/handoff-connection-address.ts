import { connectionBaseAddress } from "./broker-policy.ts";
import type { BrokerCaller } from "./broker-port.ts";
import { secretManifestOf } from "./connection-credentials.ts";
import type { AppApiStorage } from "./storage.ts";

/**
 * The address a handoff operation's `connection-url` argument gets: its
 * connection's base address, as the credential broker would reach it, read
 * again at each command. The connection's saved secret states decide
 * whether it is available, as for an operation's start, so no secret is
 * decrypted. Throws, and the command is refused, when the connection is
 * paused: a required secret was removed or rejected, or the vault can't
 * read one. Undefined when the connection no longer exists.
 */
export async function handoffConnectionAddress(
  storage: Pick<AppApiStorage, "connectionForOperation">,
  caller: BrokerCaller,
): Promise<string | undefined> {
  if (!caller.connectionId) return undefined;
  const connection = await storage.connectionForOperation(
    caller.pluginId,
    caller.connectionId,
    secretManifestOf(caller.manifest),
  );
  // The base address field is never secret, so the editable values hold it.
  // On-premises counts only while the manifest still allows it.
  return connection
    ? connectionBaseAddress(caller.manifest, {
        id: connection.id,
        values: connection.config,
        secrets: [],
        onPremises: connection.onPremises === true,
        access: connection.access ?? [],
      })
    : undefined;
}
