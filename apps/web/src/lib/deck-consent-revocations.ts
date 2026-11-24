import { z } from "zod";

/*
 * Deck's revoked consents (#791), told to every window. Settings › Agents
 * can revoke a repository in another window than the review page asking
 * about it, and the local API's stream reaches one window only. Revoke tells
 * this window's listeners at once, and the others through storage: the
 * entry holds the repository and the time, never an answer.
 */

/** The storage entry another window's revocation reaches this one through. */
export const DECK_CONSENT_REVOKED_STORAGE_KEY = "ajour.deck-consent-revoked";

/** The repository whose consent was taken back. */
export interface RevokedDeckRepository {
  pluginId: string;
  connectionId: string;
  repository: string;
}

const revokedSchema = z.object({
  pluginId: z.string(),
  connectionId: z.string(),
  repository: z.string(),
  at: z.number(),
});

/** A revocation as heard: the repository, and when it was taken back. */
export type DeckConsentRevocation = RevokedDeckRepository & { at: number };

type Listener = (revoked: DeckConsentRevocation) => void;

const listeners = new Set<Listener>();

/** Tells every window, this one first, that `revoked` asks again. */
export function announceDeckConsentRevoked(revoked: RevokedDeckRepository) {
  const { pluginId, connectionId, repository } = revoked;
  // The time makes each revocation a change, so other windows hear it, and
  // lets a late one leave the answers asked after it.
  const at = Date.now();
  for (const listener of [...listeners]) {
    listener({ pluginId, connectionId, repository, at });
  }
  try {
    window.localStorage.setItem(
      DECK_CONSENT_REVOKED_STORAGE_KEY,
      JSON.stringify({ pluginId, connectionId, repository, at }),
    );
  } catch {
    // Without storage, only this window hears it.
  }
}

/** Calls `listener` with each repository revoked, in this window or another. */
export function watchDeckConsentRevocations(listener: Listener) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DECK_CONSENT_REVOKED_STORAGE_KEY || !event.newValue) {
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(event.newValue);
    } catch {
      return;
    }
    const parsed = revokedSchema.safeParse(value);
    if (parsed.success) listener(parsed.data);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
