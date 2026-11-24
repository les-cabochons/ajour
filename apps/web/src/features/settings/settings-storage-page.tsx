import { useEffect, useState } from "react";
import type { DeckCacheStorage } from "@ajour/shared/deck";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { OptionSelect } from "@/components/ui/option-select";
import { showErrorToast, showToast } from "@/components/ui/toast";
import {
  clearDeckCache,
  getDeckCacheStorage,
  saveDeckCacheCap,
} from "@/lib/app-api";
import { formatBytes } from "./diagnostics-settings-model";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** The size limits Settings › Storage offers. 1 GB is the default. */
const CAP_CHOICES = [
  { value: 250 * MB, label: "250 MB" },
  { value: 500 * MB, label: "500 MB" },
  { value: GB, label: "1 GB" },
  { value: 2 * GB, label: "2 GB" },
  { value: 5 * GB, label: "5 GB" },
  { value: 10 * GB, label: "10 GB" },
] as const;

const capLabel = (capBytes: number) =>
  CAP_CHOICES.find((choice) => choice.value === capBytes)?.label ??
  formatBytes(capBytes);

const describeEntries = (count: number) =>
  count === 0
    ? "Nothing cached."
    : `${count} ${count === 1 ? "version" : "versions"} of pull requests.`;

/**
 * Settings › Storage (#781): Deck's content cache on this computer, its size
 * and its cap, with Clear cache. The local API owns the cache; the page
 * never learns where it is on disk.
 */
export function SettingsStoragePage() {
  const [storage, setStorage] = useState<DeckCacheStorage | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    getDeckCacheStorage().then(
      (read) => {
        if (current) setStorage(read);
      },
      () => {
        if (current) setReadFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const options: { value: string; label: string }[] = CAP_CHOICES.map(
    ({ value, label }) => ({
      value: String(value),
      label,
    }),
  );
  // A cap set some other way still shows as chosen.
  if (storage && !CAP_CHOICES.some(({ value }) => value === storage.capBytes)) {
    options.push({
      value: String(storage.capBytes),
      label: capLabel(storage.capBytes),
    });
  }

  const saveCap = (next: string) => {
    const capBytes = Number(next);
    if (!storage || busy || capBytes === storage.capBytes) return;
    setBusy(true);
    saveDeckCacheCap(capBytes)
      .then(setStorage, () =>
        showErrorToast({
          title: "Couldn't save the size limit",
          description: "The size limit stays as it was.",
        }),
      )
      .finally(() => setBusy(false));
  };

  const clear = () => {
    setBusy(true);
    clearDeckCache()
      .then(
        (cleared) => {
          setStorage(cleared);
          showToast("Cache cleared");
        },
        () =>
          showErrorToast({
            title: "Couldn't clear the cache",
            description: "Some cached files may remain.",
          }),
      )
      .finally(() => setBusy(false));
  };

  const locked = !storage || busy;
  return (
    <div className="settings-sections settings-measure">
      <section className="settings-section">
        <h2 className="settings-section-title">Content cache</h2>
        <p className="settings-section-desc">
          Deck keeps the pull requests it reads on this computer, both versions
          of each changed file and the diff, so they open at once. Clear cache
          removes them, and each loads from the code host again when it opens.
          Your draft reviews aren't part of it.
        </p>
        {readFailed ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't read the content cache.
          </p>
        ) : null}
        <AppPanel>
          <SettingRow
            label="Used"
            description={
              storage ? (
                <>
                  <span className="block tabular-nums">
                    {`${formatBytes(storage.sizeBytes)} of ${capLabel(storage.capBytes)}`}
                  </span>
                  <span className="block">
                    {describeEntries(storage.entryCount)}
                  </span>
                </>
              ) : null
            }
          >
            <Button
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={clear}
            >
              Clear cache
            </Button>
          </SettingRow>
          <SettingRow
            label="Size limit"
            labelFor="deck-cache-cap"
            description="Past it, merged and closed pull requests go first, then those opened longest ago. The pull request on screen stays."
          >
            <OptionSelect
              id="deck-cache-cap"
              value={storage ? String(storage.capBytes) : ""}
              options={options}
              disabled={locked}
              onChange={saveCap}
            />
          </SettingRow>
        </AppPanel>
      </section>
    </div>
  );
}
