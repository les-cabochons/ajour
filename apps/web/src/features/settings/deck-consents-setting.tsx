import { useEffect, useState } from "react";
import type { DeckAgentConsent } from "@ajour/shared/deck";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { useAgentRunner } from "@/lib/agent-runner";
import {
  getDeckConsents,
  isPluginApiMissing,
  revokeDeckConsent,
} from "@/lib/app-api";
import { announceDeckConsentRevoked } from "@/lib/deck-consent-revocations";

/**
 * Settings › Agents › Questions about pull requests (#791): the repositories
 * whose pull requests the user allowed Deck to send to an agent when they
 * ask, each with the agent allowed and Revoke. A revoked repository asks
 * again on its next question.
 */
export function DeckConsentsSetting() {
  const runner = useAgentRunner();
  const [consents, setConsents] = useState<DeckAgentConsent[]>();
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    getDeckConsents().then(
      (answer) => {
        if (current) setConsents(answer.consents);
      },
      (cause: unknown) => {
        if (!current) return;
        if (isPluginApiMissing(cause)) setUnavailable(true);
        else setError("Couldn't read the repositories you allowed.");
      },
    );
    return () => {
      current = false;
    };
  }, []);

  if (unavailable) return null;
  const agentLabel = (consent: DeckAgentConsent) => {
    const cli =
      runner.kind === "ready"
        ? runner.overview.clis.find((entry) => entry.id === consent.cli)
        : undefined;
    return [cli?.label ?? consent.cli, consent.cliVersion]
      .filter(Boolean)
      .join(" ");
  };
  const revoke = async (consent: DeckAgentConsent) => {
    setError(null);
    try {
      const answer = await revokeDeckConsent({
        pluginId: consent.pluginId,
        connectionId: consent.connectionId,
        repository: consent.repository,
      });
      setConsents(answer.consents);
      // A review page asking about it, here or in another window, hides its answers.
      announceDeckConsentRevoked(consent);
    } catch {
      setError(`Couldn't revoke ${consent.repository}.`);
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Questions about pull requests</h2>
      <p className="settings-section-desc">
        When you ask for more detail in Deck, Ajour sends the pull request's
        changed lines, the hunks and files the agent reads, and its review
        threads to the agent, which sends them to its provider. Each repository
        asks once.
      </p>
      <AppPanel>
        {consents === undefined ? null : consents.length ? (
          consents.map((consent) => (
            <SettingRow
              key={`${consent.pluginId} ${consent.connectionId} ${consent.repository}`}
              label={consent.repository}
              description={`${agentLabel(consent)} · allowed ${new Date(
                consent.consentedAt,
              ).toLocaleDateString(undefined, { dateStyle: "medium" })}`}
            >
              <Button
                variant="outline"
                size="sm"
                aria-label={`Revoke ${consent.repository}`}
                onClick={() => void revoke(consent)}
              >
                Revoke
              </Button>
            </SettingRow>
          ))
        ) : (
          <p className="settings-row-desc">
            None yet. Deck asks the first time you ask about a repository's pull
            request.
          </p>
        )}
      </AppPanel>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
