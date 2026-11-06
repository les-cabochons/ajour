import {
  Field,
  FieldContent,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import type { PluginField, PluginFieldValue } from "@ajour/shared";
import { useNumberDraft } from "@/lib/number-draft";
import { FieldHelp } from "./field-help";
import { SecretFieldInput, type SecretFieldBinding } from "./secret-field";

/**
 * One field of a connection or agent task form. A field marked secret, of any
 * type, is a `SecretFieldInput` whatever its type says, so a secret address
 * is never shown as text. Its `secret` binding says how its saved state and
 * reminder date behave; without one it is a field for a new secret.
 */
function PluginFieldInput({
  field,
  value,
  onChange,
  secret,
  hideHelp = false,
  label = field.label,
  row = false,
}: {
  field: PluginField;
  value: PluginFieldValue | undefined;
  onChange: (nextValue: PluginFieldValue) => void;
  secret?: SecretFieldBinding;
  /** Set when the form shows this help once, under a row of fields. */
  hideHelp?: boolean;
  /** A shorter label, when a legend above the field says the rest. */
  label?: string;
  /**
   * A settings row: the label on the left, the value on the right reading as
   * text, its field drawn only on hover and focus (forms council round 8).
   */
  row?: boolean;
}) {
  const help = hideHelp ? undefined : field.helpText;
  if (row && !field.secret) {
    return (
      <div className="connection-row">
        {field.type === "checkbox" ? (
          <label htmlFor={field.id} className="connection-row-label">
            {label}
          </label>
        ) : (
          <FieldLabel htmlFor={field.id} className="connection-row-label">
            {label}
          </FieldLabel>
        )}
        <div className="connection-row-value">
          {field.type === "checkbox" ? (
            // A yes-or-no setting is a switch, as on every settings row.
            <Switch
              id={field.id}
              checked={value === true}
              onCheckedChange={(checked) => onChange(checked)}
            />
          ) : field.type === "select" ? (
            <OptionSelect
              id={field.id}
              size="default"
              className="inline-field"
              value={typeof value === "string" ? value : ""}
              onChange={onChange}
              options={field.options ?? []}
            />
          ) : field.type === "number" ? (
            <PluginNumberInput
              field={field}
              value={value}
              onChange={onChange}
              className="inline-field"
              placeholder={
                field.placeholder ? `e.g. ${field.placeholder}` : "Not set"
              }
            />
          ) : (
            <Input
              id={field.id}
              className="inline-field"
              type="text"
              value={
                typeof value === "number"
                  ? String(value)
                  : typeof value === "boolean"
                    ? value
                      ? "true"
                      : "false"
                    : (value ?? "")
              }
              min={field.min}
              max={field.max}
              step={field.step}
              onChange={(event) => onChange(event.target.value)}
              // The plugin's placeholder says what to type, never a value, so
              // an empty row never reads as a saved one. Settings show it in
              // italics (styles/settings.css).
              placeholder={field.placeholder ?? "Not set"}
              autoComplete="off"
            />
          )}
          {help ? <FieldHelp text={help} /> : null}
        </div>
      </div>
    );
  }
  if (field.secret) {
    return (
      <SecretFieldInput
        field={field}
        row={row}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        binding={
          secret ?? {
            existing: false,
            expiry: "",
            onExpiryChange: () => {},
            now: Date.now(),
            removeEffect: "",
          }
        }
      />
    );
  }

  if (field.type === "checkbox") {
    return (
      <Field orientation="horizontal">
        <Checkbox
          id={field.id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          className="mt-0.5"
        />
        <FieldContent>
          <FieldTitle>{label}</FieldTitle>
          {help ? <FieldHelp text={help} /> : null}
        </FieldContent>
      </Field>
    );
  }

  if (field.type === "select") {
    return (
      <Field>
        <FieldLabel htmlFor={field.id}>{label}</FieldLabel>
        <FieldContent>
          <OptionSelect
            id={field.id}
            size="default"
            value={typeof value === "string" ? value : ""}
            onChange={onChange}
            options={field.options ?? []}
          />
          {help ? <FieldHelp text={help} /> : null}
        </FieldContent>
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor={field.id}>{label}</FieldLabel>
      <FieldContent>
        {field.type === "number" ? (
          <PluginNumberInput
            field={field}
            value={value}
            onChange={onChange}
            placeholder={field.placeholder}
          />
        ) : (
          <Input
            id={field.id}
            type={field.type === "password" ? "password" : "text"}
            value={
              typeof value === "number"
                ? String(value)
                : typeof value === "boolean"
                  ? value
                    ? "true"
                    : "false"
                  : (value ?? "")
            }
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.placeholder}
            autoComplete="off"
          />
        )}
        {help ? <FieldHelp text={help} /> : null}
      </FieldContent>
    </Field>
  );
}

/**
 * A plugin's number field. It can be empty or half-typed while the user
 * types; each valid number goes to the form, and leaving the field with
 * text it doesn't take says why under it.
 */
function PluginNumberInput({
  field,
  value,
  onChange,
  className,
  placeholder,
}: {
  field: PluginField;
  value: PluginFieldValue | undefined;
  onChange: (nextValue: PluginFieldValue) => void;
  className?: string;
  placeholder?: string;
}) {
  const { inputProps, error } = useNumberDraft({
    value: typeof value === "number" ? value : undefined,
    rule: {
      min: field.min,
      max: field.max,
      message:
        field.min !== undefined && field.max !== undefined
          ? `Enter a number from ${field.min} to ${field.max}.`
          : field.min !== undefined
            ? `Enter a number of at least ${field.min}.`
            : field.max !== undefined
              ? `Enter a number up to ${field.max}.`
              : "Enter a number.",
    },
    live: true,
    onCommit: onChange,
  });
  return (
    <>
      <Input
        id={field.id}
        className={className}
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        placeholder={placeholder}
        autoComplete="off"
        {...inputProps}
      />
      {error ? (
        <span role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </>
  );
}

export { PluginFieldInput };
