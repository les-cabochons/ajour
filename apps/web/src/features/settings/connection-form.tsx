import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  isCapabilityActive,
  pluginConnectionFormFields,
  pluginHasTeam,
  type PluginConnectionSummary,
  type PluginField,
  type PluginOverviewGroup,
  type VaultStatusSummary,
} from "@ajour/shared";
import { AppPanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import {
  areExpiryDraftsValid,
  canSubmitPluginForm,
  groupConnectionFields,
  sectionConnectionBlocks,
  type ConnectionFormBlock,
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
  saveHint,
  now,
  onCancel,
  onSave,
  onRemoveSecret,
  status,
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
  /** Set while the plugin can't save: the way out. Save stays off. */
  saveHint?: string;
  now: number;
  onCancel: () => void;
  onSave: () => void;
  onRemoveSecret: (fieldId: string) => void;
  /** The edited connection's status chip and note: the form stands in for its row. */
  status?: ReactNode;
}) {
  const { plugin } = group;
  const editing = form.editingConnectionId !== null;
  const blockedReason = vaultBlockedReason(vault);
  const savedSecrets = new Set(
    connection?.secretFields?.map((secret) => secret.id),
  );
  const update = (patch: (current: PluginFormState) => PluginFormState) =>
    setForm((current) => (current ? patch(current) : current));

  const renderField = (
    field: PluginField,
    { label, hideHelp }: { label?: string; hideHelp?: boolean } = {},
  ) => (
    <PluginFieldInput
      label={label}
      hideHelp={hideHelp}
      row
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

  const shownFields = pluginConnectionFormFields(plugin).filter((field) =>
    isPluginFieldShown(plugin, field, form.values, group.inactiveCapabilities),
  );

  const renderBlock = (block: ConnectionFormBlock) =>
    block.kind === "field" ? (
      renderField(block.field)
    ) : (
      <fieldset
        key={`${form.instance}/${block.fields[0]!.field.id}`}
        className="connection-row"
      >
        <legend className="sr-only">{block.legend}</legend>
        <span aria-hidden className="connection-row-label">
          {block.legend}
        </span>
        <div className="connection-row-value">
          <div className="composer-chips">
            {block.fields.map(({ field, label }) => (
              <div
                key={`${form.instance}/${field.id}`}
                className="composer-chip composer-estimate"
              >
                <label htmlFor={field.id}>{label}</label>
                <input
                  id={field.id}
                  className="composer-estimate-input"
                  autoComplete="off"
                  inputMode={field.type === "number" ? "numeric" : undefined}
                  value={String(form.values[field.id] ?? "")}
                  onChange={(event) => {
                    const text = event.target.value;
                    const next =
                      field.type === "number"
                        ? Number.isFinite(Number(text))
                          ? Number(text)
                          : 0
                        : text;
                    update((current) => ({
                      ...current,
                      values: { ...current.values, [field.id]: next },
                    }));
                  }}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{block.help}</p>
        </div>
      </fieldset>
    );
  const sections = sectionConnectionBlocks(groupConnectionFields(shownFields));

  return (
    <AppPanel className="connection-form pb-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The form's title outranks its section headings. */}
          <h3 className="text-base font-semibold text-foreground">
            {editing
              ? `Edit ${connection?.label ?? `${plugin.displayName} connection`}`
              : `New ${plugin.displayName} connection`}
          </h3>
          {status}
        </div>
        {editing ? null : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            The plugin checks the connection, and Ajour keeps it on this
            computer.
          </p>
        )}
      </div>
      {/* One column at a reading measure, as Linear's forms are. */}
      <FieldGroup className="connection-rows max-w-xl gap-6">
        {sections.map((section) =>
          sections.length === 1 ? (
            section.blocks.map(renderBlock)
          ) : (
            // Titled parts, Connection, Sync and Field mapping, so a long
            // form scans like Linear's settings (forms council round 4).
            <section
              key={section.title}
              aria-label={section.title}
              className="flex flex-col gap-1 border-t border-[var(--border-row)] pt-4 first:border-t-0 first:pt-0"
            >
              <h4 className="text-sm font-semibold text-foreground">
                {section.title}
              </h4>
              {section.blocks.map(renderBlock)}
            </section>
          ),
        )}
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
      {saveHint ? (
        <p className="max-w-xl text-xs text-muted-foreground" data-save-hint>
          {saveHint}
        </p>
      ) : null}
      <div className="flex max-w-xl flex-wrap justify-end gap-2 pt-2">
        <Button variant="ghost" disabled={isMutating} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={
            isMutating ||
            Boolean(saveHint) ||
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
