import { useEffect, useState } from "react";
import type { DeckClone } from "@ajour/shared/deck";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import {
  forgetDeckClone,
  getDeckClones,
  isPluginApiMissing,
} from "@/lib/app-api";

/**
 * Settings › Agents › Local clones (#795): the clone the user chose for each
 * repository, which Deck's answers read at the pull request's head, each
 * with Forget. A clone is chosen from an answer in Deck, where the pull
 * request says where the repository is cloned from.
 */
export function DeckClonesSetting() {
  const [clones, setClones] = useState<DeckClone[]>();
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    getDeckClones().then(
      (answer) => {
        if (current) setClones(answer.clones);
      },
      (cause: unknown) => {
        if (!current) return;
        if (isPluginApiMissing(cause)) setUnavailable(true);
        else setError("Couldn't read your local clones.");
      },
    );
    return () => {
      current = false;
    };
  }, []);

  if (unavailable) return null;
  const forget = async (clone: DeckClone) => {
    setError(null);
    try {
      const answer = await forgetDeckClone({
        pluginId: clone.pluginId,
        connectionId: clone.connectionId,
        repository: clone.repository,
      });
      setClones(answer.clones);
    } catch {
      setError(`Couldn't forget the clone of ${clone.repository}.`);
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Local clones</h2>
      <p className="settings-section-desc">
        With your clone of a repository, answers read the whole codebase at the
        pull request's head, and the agent sends what it reads to its provider.
        Ajour fetches the pull request into your clone with your own Git
        sign-in, and never changes your branches or files.
      </p>
      <AppPanel>
        {clones === undefined ? null : clones.length ? (
          clones.map((clone) => (
            <SettingRow
              key={`${clone.pluginId} ${clone.connectionId} ${clone.repository}`}
              label={clone.repository}
              description={
                clone.environment.kind === "wsl"
                  ? `${clone.path} · WSL ${clone.environment.distro}`
                  : clone.path
              }
            >
              <Button
                variant="outline"
                size="sm"
                aria-label={`Forget the clone of ${clone.repository}`}
                onClick={() => void forget(clone)}
              >
                Forget
              </Button>
            </SettingRow>
          ))
        ) : (
          <p className="settings-row-desc">
            None yet. Choose one from an answer in Deck, with Read your clone
            too.
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
