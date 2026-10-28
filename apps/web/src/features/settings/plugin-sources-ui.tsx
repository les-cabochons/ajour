import { useState } from "react";
import { RiAddLine as Plus, RiDeleteBinLine as Trash2 } from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MessagePanel } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type {
  PluginCatalogSource,
  PluginSourceInspection,
  PluginSourceState,
} from "@ajour/shared";

/*
 * The plugin sources part of Settings > Plugins: the repositories whose
 * ajour.json lists plugins, how far Ajour trusts each, and adding, approving
 * and removing them. The desktop main process reads and checks every source;
 * this module only shows what it found.
 */

export const OFFICIAL_PLUGIN_SOURCE_URL =
  "https://github.com/les-cabochons/ajour-plugins";

const stateLabels: Record<PluginSourceState, string> = {
  signed: "Signed",
  unsigned: "Unsigned",
  untrusted_key: "Key not approved",
  key_changed: "Key changed",
  signature_missing: "Signature missing",
  bad_signature: "Signature invalid",
  unreachable: "Unreachable",
};

const stateVariants: Record<
  PluginSourceState,
  "secondary" | "outline" | "destructive"
> = {
  signed: "secondary",
  unsigned: "outline",
  untrusted_key: "outline",
  key_changed: "destructive",
  signature_missing: "destructive",
  bad_signature: "destructive",
  unreachable: "destructive",
};

/** States a person can resolve by reviewing the source and approving it again. */
const reviewableStates = new Set<PluginSourceState>([
  "untrusted_key",
  "key_changed",
  "signature_missing",
]);

function addressLabel(url: string) {
  return url.replace(/^https:\/\//, "");
}

function sourceMeta(source: PluginCatalogSource) {
  return [
    addressLabel(source.url),
    `${source.pluginCount} plugin${source.pluginCount === 1 ? "" : "s"}`,
    source.keyFingerprint ? `key ${source.keyFingerprint}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What a source holds, read before it is added or its key approved: its
 * plugins, and the key that signs it or the warning that nothing does.
 */
function PluginSourceReviewDialog({
  inspection,
  approving,
  isMutating,
  onOpenChange,
  onConfirm,
}: {
  inspection: PluginSourceInspection | null;
  /** True when the source is already added and only its key is approved. */
  approving: boolean;
  isMutating: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (inspection: PluginSourceInspection) => void;
}) {
  return (
    <Dialog open={inspection !== null} onOpenChange={onOpenChange}>
      {inspection ? (
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {approving
                ? `Trust ${inspection.name} as it is signed now?`
                : `Add ${inspection.name}?`}
            </DialogTitle>
            <DialogDescription className="break-all">
              {addressLabel(inspection.url)}
            </DialogDescription>
          </DialogHeader>

          {inspection.signed ? (
            <p className="text-sm text-muted-foreground">
              Signed with key{" "}
              <span className="font-mono text-foreground">
                {inspection.keyFingerprint}
              </span>
              . From now on Ajour trusts this source only with this key. If you
              can, check the key with its publisher.
            </p>
          ) : (
            <MessagePanel tone="warning">
              This source isn't signed, so Ajour can't check who published its
              plugins or that nobody changed them. Installing one needs Allow
              installing unsigned plugins, and Ajour warns you each time.
            </MessagePanel>
          )}
          {inspection.official ? null : (
            <p className="text-sm text-muted-foreground">
              Add only sources you trust. A plugin runs with the access you give
              its connections.
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">
              {inspection.plugins.length} plugin
              {inspection.plugins.length === 1 ? "" : "s"}
            </h3>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {inspection.plugins.map((plugin) => (
                <li
                  key={plugin.id}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate text-foreground">
                    {plugin.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-[var(--text-tertiary)]">
                    {plugin.version}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={isMutating} onClick={() => onConfirm(inspection)}>
              {approving
                ? inspection.signed
                  ? "Trust this key"
                  : "Accept unsigned"
                : "Add source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function PluginSourceRow({
  source,
  canManage,
  isMutating,
  isReviewing,
  onReview,
  onRemove,
}: {
  source: PluginCatalogSource;
  canManage: boolean;
  isMutating: boolean;
  isReviewing: boolean;
  onReview: () => void;
  onRemove: () => void;
}) {
  const name = source.name ?? addressLabel(source.url);
  return (
    <div className="flex flex-col gap-2 py-2.5 desktop:flex-row desktop:items-start desktop:gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-sm font-medium break-words text-foreground">
            {name}
          </span>
          {source.official ? <Badge variant="secondary">Official</Badge> : null}
          <Badge variant={stateVariants[source.state]}>
            {stateLabels[source.state]}
          </Badge>
        </span>
        <span className="text-xs break-all text-[var(--text-tertiary)]">
          {sourceMeta(source)}
        </span>
        {source.message ? (
          <span className="text-[13px] leading-5 text-muted-foreground">
            {source.message}
          </span>
        ) : null}
        {source.approvedKeyFingerprint ? (
          <span className="text-[13px] leading-5 text-muted-foreground">
            You approved key{" "}
            <span className="font-mono">{source.approvedKeyFingerprint}</span>.
          </span>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {reviewableStates.has(source.state) ? (
            <Button
              variant="outline"
              disabled={isMutating || isReviewing}
              onClick={onReview}
            >
              {isReviewing ? "Reading…" : "Review"}
            </Button>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  disabled={isMutating}
                  aria-label={`Remove ${name}`}
                />
              }
            >
              <Trash2 data-icon="inline-start" />
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Ajour stops listing its plugins. Plugins you installed from it
                  stay installed, and no longer get updates.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onRemove}>
                  Remove source
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Plugin sources section: every repository Ajour reads plugins from,
 * with its trust state, and adding one by its address.
 */
export function PluginSourcesSection({
  sources,
  canManage,
  isMutating,
  onInspect,
  onAdd,
  onRemove,
}: {
  sources: PluginCatalogSource[];
  /** False outside the desktop app, where Ajour reads no sources. */
  canManage: boolean;
  isMutating: boolean;
  onInspect: (url: string) => Promise<PluginSourceInspection>;
  /** Resolves true when the source was added or its key approved. */
  onAdd: (url: string, keyFingerprint: string | null) => Promise<boolean>;
  onRemove: (source: PluginCatalogSource) => void;
}) {
  const [address, setAddress] = useState("");
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    inspection: PluginSourceInspection;
    approving: boolean;
  } | null>(null);

  const inspect = async (url: string, approving: boolean) => {
    setReading(url);
    setError(null);
    try {
      const inspection = await onInspect(url);
      // Adding a source that is already there approves how it is signed now.
      setReview({
        inspection,
        approving: approving || inspection.alreadyAdded,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Ajour couldn't read it.",
      );
    } finally {
      setReading(null);
    }
  };

  const confirm = async (inspection: PluginSourceInspection) => {
    if (await onAdd(inspection.url, inspection.keyFingerprint ?? null)) {
      setReview(null);
      setAddress("");
    }
  };

  const hasOfficial = sources.some(
    (source) => source.url === OFFICIAL_PLUGIN_SOURCE_URL,
  );

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Plugin sources</h2>

      <div className="flex flex-col gap-1">
        {sources.length > 0 ? (
          sources.map((source) => (
            <PluginSourceRow
              key={source.url}
              source={source}
              canManage={canManage}
              isMutating={isMutating}
              isReviewing={reading === source.url}
              onReview={() => void inspect(source.url, true)}
              onRemove={() => onRemove(source)}
            />
          ))
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No plugin sources. Ajour lists only the plugins you install from a
            file.
          </p>
        )}
      </div>

      {canManage ? (
        <Field>
          <FieldLabel htmlFor="plugin-source-address">Add a source</FieldLabel>
          <FieldContent>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void inspect(address.trim(), false);
              }}
            >
              <Input
                id="plugin-source-address"
                className="max-w-96 min-w-0 flex-1"
                placeholder="https://github.com/owner/repository"
                value={address}
                maxLength={500}
                inputMode="url"
                aria-invalid={error ? true : undefined}
                onChange={(event) => setAddress(event.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={isMutating || reading !== null || !address.trim()}
              >
                <Plus data-icon="inline-start" />
                {reading === address.trim() ? "Reading…" : "Add source"}
              </Button>
              {hasOfficial ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isMutating || reading !== null}
                  onClick={() =>
                    void inspect(OFFICIAL_PLUGIN_SOURCE_URL, false)
                  }
                >
                  Add the official source
                </Button>
              )}
            </form>
            {error ? (
              <p className="text-sm break-words text-destructive">{error}</p>
            ) : (
              <FieldDescription>
                Paste the repository's address. Ajour reads it and shows you its
                plugins before anything is added.
              </FieldDescription>
            )}
          </FieldContent>
        </Field>
      ) : null}

      <PluginSourceReviewDialog
        inspection={review?.inspection ?? null}
        approving={review?.approving ?? false}
        isMutating={isMutating}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
        onConfirm={(inspection) => void confirm(inspection)}
      />
    </section>
  );
}
