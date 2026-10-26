import type { Dispatch, SetStateAction } from "react";
import {
  isCapabilityActive,
  pluginConnectionFormFields,
  pluginHasTeam,
  type PluginConnectionSummary,
  type PluginOverviewGroup,
  type VaultStatusSummary,
} from "@ajour/shared";
import { AppPanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import {
  areExpiryDraftsValid,
  canSubmitPluginForm,
  isPluginFieldShown,
  isPluginFormDirty,
  withAccessChoice,
  type PluginFormState,
} from "./plugin-form-state";
import { ConnectionAccessGroup } from "./connection-access-ui";
import { PluginFieldInput } from "./plugin-settings-ui";
import { TeamCreateField } from "./team-connection-ui";

/** Why a secret can't be saved on this computer, or undefined while it can. */
export function vaultBlockedReason(status: VaultStatusSummary | undefined) {
  return status?.state === "unavailable"
    ? `Ajour can't protect credentials on this computer, so it can't save a secret. ${status.reason}`.trim()
    : undefined;
}

/**
 * The connection form of a plugin page: its fields from the manifest, a
 * secret field with its saved state, Replace and Remove, and the buttons. The
 * page owns the state and the save; this renders them.
 */
export function PluginConnectionForm({
  group,
  form,
  setForm,
  connection,
  vault,
  isMutating,
  heldCount = 0,
  now,
  onCancel,
  onSave,
  onRemoveSecret,
}: {
  group: PluginOverviewGroup;
  form: PluginFormState;
  setForm: Dispatch<SetStateAction<PluginFormState | null>>;
  /** The connection being edited, if any. */
  connection: PluginConnectionSummary | undefined;
  vault: VaultStatusSummary | undefined;
  isMutating: boolean;
  /** The changes the connection holds on this computer. */
  heldCount?: number;
  now: number;
  onCancel: () => void;
  onSave: () => void;
  onRemoveSecret: (fieldId: string) => void;
}) {
  const { plugin } = group;
  const editing = form.editingConnectionId !== null;
  const blockedReason = vaultBlockedReason(vault);
  const savedSecrets = new Set(
    connection?.secretFields?.map((secret) => secret.id),
  );
  const update = (patch: (current: PluginFormState) => PluginFormState) =>
    setForm((current) => (current ? patch(current) : current));

  return (
    <AppPanel className="pb-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {editing
            ? `Edit ${plugin.displayName} connection`
            : `New ${plugin.displayName} connection`}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {editing
            ? "Update this connection without re-entering unchanged secrets."
            : "The connection is validated by the plugin and stored locally."}
        </p>
      </div>
      <FieldGroup className="desktop:grid desktop:grid-cols-2 desktop:gap-x-6 desktop:gap-y-5">
        {pluginConnectionFormFields(plugin).map((field) => {
          if (
            !isPluginFieldShown(
              plugin,
              field,
              form.values,
              group.inactiveCapabilities,
            )
          ) {
            return null;
          }

          return (
            <PluginFieldInput
              // A form opened anew starts its secret fields over.
              key={`${form.instance}/${field.id}`}
              field={field}
              value={form.values[field.id]}
              onChange={(nextValue) =>
                update((current) => ({
                  ...current,
                  values: { ...current.values, [field.id]: nextValue },
                }))
              }
              secret={
                field.secret
                  ? {
                      existing: editing,
                      summary: connection?.secretFields?.find(
                        (secret) => secret.id === field.id,
                      ),
                      expiry: form.expiry[field.id] ?? "",
                      onExpiryChange: (expiry) =>
                        update((current) => ({
                          ...current,
                          expiry: { ...current.expiry, [field.id]: expiry },
                        })),
                      onRemove: () => onRemoveSecret(field.id),
                      startReplacing: form.replaceFieldId === field.id,
                      blockedReason,
                      now,
                      busy: isMutating,
                      removeEffect: field.required
                        ? `${connection?.label ?? "This connection"} pauses until you add a new one. Its settings and synced data stay.`
                        : "Ajour deletes it from this computer. The connection's settings and synced data stay.",
                    }
                  : undefined
              }
            />
          );
        })}
        {pluginHasTeam(plugin) && !editing ? (
          <TeamCreateField
            pluginId={plugin.id}
            values={form.values}
            disabled={isMutating || !isCapabilityActive(group, "team")}
            onCreated={(created) =>
              // Only into the form that asked: one closed or opened anew
              // meanwhile keeps its own values.
              update((current) =>
                current.instance === form.instance
                  ? {
                      ...current,
                      values: { ...current.values, ...created },
                    }
                  : current,
              )
            }
          />
        ) : null}
        <ConnectionAccessGroup
          choices={group.connectionAccess ?? []}
          access={form.access}
          heldCount={heldCount}
          disabled={isMutating}
          onChange={(choiceId, on) =>
            update((current) => withAccessChoice(current, choiceId, on))
          }
        />
      </FieldGroup>
      <div className="flex flex-wrap justify-end gap-3 pt-2">
        <Button variant="outline" disabled={isMutating} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={
            isMutating ||
            !isPluginFormDirty(plugin, form) ||
            !areExpiryDraftsValid(form.expiry) ||
            !canSubmitPluginForm(plugin, form.values, {
              savedSecrets,
              inactiveCapabilities: group.inactiveCapabilities,
            })
          }
          onClick={onSave}
        >
          {editing ? "Update connection" : "Add connection"}
        </Button>
      </div>
    </AppPanel>
  );
}
