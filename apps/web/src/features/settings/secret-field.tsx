import { useState } from "react";
import type { PluginField, SecretFieldSummary } from "@ajour/shared";
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
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DateField } from "@/components/ui/date-field";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { describeLastUse, describeSecret } from "@/domain/plugins/secret-state";

/**
 * What a secret field needs from its form, beyond the field itself. The
 * form owns the typed value and the reminder date; the saved secret's state
 * comes from the API, which never sends a value.
 */
export interface SecretFieldBinding {
  /** The saved secret, or undefined when the connection has none ("Not set"). */
  summary?: SecretFieldSummary;
  /**
   * The connection exists, so the field shows the state of its secret. A new
   * connection shows only the input.
   */
  existing: boolean;
  /** The reminder date as date text, "2026-10-28", or "". */
  expiry: string;
  onExpiryChange: (expiry: string) => void;
  /** Deletes the saved secret now. Absent when nothing can be removed. */
  onRemove?: () => void;
  /** Opens with Replace already open, as when the Vault sent the user here. */
  startReplacing?: boolean;
  /** Ajour can't keep a secret on this computer: the field is disabled. */
  blockedReason?: string;
  /** The clock, so the chip and last use are deterministic in tests. */
  now: number;
  /** What Remove means for the owner, in a sentence, for its confirmation. */
  removeEffect: string;
  /** Disables the buttons while something else is being saved. */
  busy?: boolean;
}

/**
 * A secret field in place of the mask: a state chip, the last use and the
 * reminder date, with Replace and Remove. Replace opens an empty password
 * input with Cancel. A saved value is never read back into the form, so a
 * field of any type (a secret address included) never shows one.
 */
export function SecretFieldInput({
  field,
  value,
  onChange,
  binding,
}: {
  field: PluginField;
  value: string;
  onChange: (value: string) => void;
  binding: SecretFieldBinding;
}) {
  const [replacing, setReplacing] = useState(binding.startReplacing === true);
  const { summary, existing, now } = binding;
  const hasSecret = existing && summary !== undefined;
  const state = describeSecret(summary, now);
  const inputId = `secret-${field.id}`;
  const blocked = binding.blockedReason !== undefined;
  const showInput = !hasSecret || replacing;
  const showExpiry = hasSecret || value.trim() !== "";

  return (
    <Field className="desktop:col-span-2">
      <FieldLabel htmlFor={showInput ? inputId : undefined}>
        {field.label}
      </FieldLabel>
      <FieldContent>
        {showInput ? (
          <div className="flex gap-2">
            <Input
              id={inputId}
              type="password"
              value={value}
              autoFocus={replacing}
              disabled={blocked}
              placeholder={
                replacing ? "Paste the new value" : field.placeholder
              }
              autoComplete="off"
              onChange={(event) => onChange(event.target.value)}
            />
            {replacing ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onChange("");
                  setReplacing(false);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        ) : null}
        {existing && !replacing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={state.tone} data-secret-state={state.kind}>
              {state.label}
            </Chip>
            {hasSecret ? (
              <span className="text-xs text-[var(--text-tertiary)]">
                {describeLastUse(summary.lastUsedAt, now)}
              </span>
            ) : null}
            <span className="flex-1" />
            {hasSecret ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={blocked || binding.busy}
                  aria-label={`Replace ${field.label}`}
                  onClick={() => setReplacing(true)}
                >
                  {state.kind === "rejected" ? "Replace token" : "Replace"}
                </Button>
                {binding.onRemove ? (
                  <RemoveSecretButton
                    label={field.label}
                    effect={binding.removeEffect}
                    disabled={blocked || binding.busy}
                    onRemove={binding.onRemove}
                  />
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {blocked ? (
          <FieldDescription>{binding.blockedReason}</FieldDescription>
        ) : (
          <FieldDescription>
            {field.helpText ? `${field.helpText} ` : ""}
            {existing
              ? `Ajour never shows a saved secret. Replace pastes a new one, and Remove ${field.required ? "pauses the connection until one is added" : "deletes it"}.`
              : "Ajour keeps it encrypted on this computer and never shows it again."}
          </FieldDescription>
        )}
        {showExpiry ? (
          <div className="flex max-w-xs flex-col gap-1 pt-2">
            <label
              htmlFor={`${inputId}-expiry`}
              className="text-xs font-medium text-muted-foreground"
            >
              {field.label} expires on (optional)
            </label>
            <DateField
              id={`${inputId}-expiry`}
              value={binding.expiry}
              disabled={blocked}
              onChange={binding.onExpiryChange}
              calendarLabel={`Pick when ${field.label} expires`}
            />
            <FieldDescription>
              A reminder only. Ajour keeps using it after this date.
            </FieldDescription>
          </div>
        ) : null}
      </FieldContent>
    </Field>
  );
}

function RemoveSecretButton({
  label,
  effect,
  disabled,
  onRemove,
}: {
  label: string;
  effect: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove ${label}`}
          >
            Remove
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
          <AlertDialogDescription>{effect}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemove}>
            Remove {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
