import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { RiDeleteBinLine as Trash2 } from "@remixicon/react";
import { MessagePanel } from "@/components/app-surface";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  buildVaultGroups,
  vaultNotice,
  type VaultGroup,
  type VaultRow,
} from "@/domain/plugins/vault-model";
import { usePluginSettingsWorkflow } from "./use-plugin-settings-workflow";

const PLUGINS_NEED_DESKTOP_APP = "Plugins need the desktop app.";

/** Where Replace goes: the connection's form with Replace open, or the plugin's task settings. */
function ReplaceButton({ row }: { row: VaultRow }) {
  const { replace } = row;
  if (!replace) return null;
  return (
    // A link that looks like the outline button: it goes to a page.
    <Link
      to="/settings/plugins/$pluginId"
      params={{ pluginId: replace.pluginId }}
      search={
        replace.type === "connection"
          ? { connection: replace.connectionId, field: replace.fieldId }
          : { field: replace.fieldId }
      }
      replace
      aria-label={`Replace ${row.owner} ${row.kind}`}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      {row.state.kind === "rejected" ? "Replace token" : "Replace"}
    </Link>
  );
}

function VaultRowView({ row }: { row: VaultRow }) {
  return (
    <div
      role="group"
      aria-label={`${row.owner}, ${row.kind}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words text-foreground">
          {row.owner}
        </p>
        <p className="text-xs text-[var(--text-tertiary)]">
          {row.kind} · {row.lastUsed}
        </p>
      </div>
      <Chip tone={row.state.tone} data-secret-state={row.state.kind}>
        {row.state.label}
      </Chip>
      <ReplaceButton row={row} />
    </div>
  );
}

/** Removes everything a plugin that is not installed left behind. */
function RemoveMissingPlugin({
  group,
  disabled,
  onRemove,
}: {
  group: VaultGroup;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove ${group.title}`}
          >
            <Trash2 data-icon="inline-start" />
            Remove
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {group.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes its saved connections and secrets from this computer.
            Backlog items already synced stay. To use the plugin again, download
            it and add its connections again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemove}>
            Remove connections and secrets
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Settings > Vault: every secret Ajour holds, grouped by plugin, with its
 * state and last use, and never a value. A plugin whose package is missing
 * comes last, with Remove. The two failures of the vault itself show at the
 * top.
 */
export function SettingsVaultPage() {
  const {
    overview,
    displayEntries,
    pluginError,
    pluginApiMissing,
    statusMessage,
    isMutatingPlugin,
    workflow,
  } = usePluginSettingsWorkflow();
  // A missing plugin has no manifest to name it, but the catalog may.
  const groups = useMemo(
    () =>
      overview
        ? buildVaultGroups(
            overview,
            Date.now(),
            new Map(
              displayEntries.map((entry) => [
                entry.catalog.id,
                entry.catalog.title,
              ]),
            ),
          )
        : [],
    [overview, displayEntries],
  );
  const notice = vaultNotice(overview?.vault);

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h1 className="text-lg font-semibold text-foreground">Vault</h1>
        <p className="settings-section-desc">
          Every secret Ajour holds on this computer, encrypted by the operating
          system. Ajour never shows or copies a saved value, and plugins never
          receive one.
        </p>
        {pluginApiMissing ? (
          <MessagePanel>{PLUGINS_NEED_DESKTOP_APP}</MessagePanel>
        ) : (
          <>
            {notice ? (
              <MessagePanel tone="warning">
                <p className="font-medium">{notice.title}</p>
                <p>{notice.body}</p>
                {notice.retry ? (
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      disabled={isMutatingPlugin}
                      onClick={() =>
                        void workflow.execute({ type: "retryVault" })
                      }
                    >
                      Try again
                    </Button>
                  </div>
                ) : null}
              </MessagePanel>
            ) : null}
            {statusMessage ? (
              <MessagePanel>{statusMessage}</MessagePanel>
            ) : null}
            {pluginError ? (
              <MessagePanel tone="warning">{pluginError}</MessagePanel>
            ) : null}
          </>
        )}
      </section>

      {groups.map((group) => (
        <section className="settings-section" key={group.pluginId}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="settings-section-title">{group.title}</h2>
            {group.installed ? null : (
              <RemoveMissingPlugin
                group={group}
                disabled={isMutatingPlugin}
                onRemove={() =>
                  void workflow.execute({
                    type: "removeMissingData",
                    pluginId: group.pluginId,
                    pluginName: group.title.replace(" (not installed)", ""),
                  })
                }
              />
            )}
          </div>
          <div>
            {group.rows.map((row) => (
              <VaultRowView key={row.key} row={row} />
            ))}
          </div>
        </section>
      ))}

      {overview && groups.length === 0 ? (
        <Empty className="items-start p-0 text-left">
          <EmptyHeader className="items-start gap-0.5">
            <EmptyTitle className="font-sans text-sm font-medium tracking-normal text-foreground">
              No saved secrets
            </EmptyTitle>
            <EmptyDescription className="text-[13px]">
              Tokens and secret addresses you save in a plugin's connection
              appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </div>
  );
}
