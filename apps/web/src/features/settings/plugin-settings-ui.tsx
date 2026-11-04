import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import type { PluginField, PluginFieldValue } from "@ajour/shared";
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
}: {
  field: PluginField;
  value: PluginFieldValue | undefined;
  onChange: (nextValue: PluginFieldValue) => void;
  secret?: SecretFieldBinding;
  /** Set when the form shows this help once, under a row of fields. */
  hideHelp?: boolean;
  /** A shorter label, when a legend above the field says the rest. */
  label?: string;
}) {
  const help = hideHelp ? undefined : field.helpText;
  if (field.secret) {
    return (
      <SecretFieldInput
        field={field}
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
          {help ? <FieldDescription>{help}</FieldDescription> : null}
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
          {help ? <FieldDescription>{help}</FieldDescription> : null}
        </FieldContent>
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor={field.id}>{label}</FieldLabel>
      <FieldContent>
        <Input
          id={field.id}
          type={
            field.type === "number"
              ? "number"
              : field.type === "password"
                ? "password"
                : "text"
          }
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
          onChange={(event) => {
            if (field.type === "number") {
              const nextValue = Number(event.target.value);
              onChange(Number.isFinite(nextValue) ? nextValue : 0);
              return;
            }

            onChange(event.target.value);
          }}
          placeholder={field.placeholder}
          autoComplete="off"
        />
        {help ? <FieldDescription>{help}</FieldDescription> : null}
      </FieldContent>
    </Field>
  );
}

export { PluginFieldInput };
