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
import { cn } from "@/lib/utils";
import type { ConnectorField, ConnectorFieldValue } from "@ajour/shared";
import { SAVED_SECRET_MASK } from "./connector-form-state";

function ConnectorFieldInput({
  field,
  value,
  onChange,
}: {
  field: ConnectorField;
  value: ConnectorFieldValue | undefined;
  onChange: (nextValue: ConnectorFieldValue) => void;
}) {
  const isWideField =
    field.type === "checkbox" ||
    field.type === "password" ||
    Boolean(field.helpText);

  if (field.type === "checkbox") {
    return (
      <Field orientation="horizontal" className="desktop:col-span-2">
        <Checkbox
          id={field.id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          className="mt-0.5"
        />
        <FieldContent>
          <FieldTitle>{field.label}</FieldTitle>
          {field.helpText ? (
            <FieldDescription>{field.helpText}</FieldDescription>
          ) : null}
        </FieldContent>
      </Field>
    );
  }

  if (field.type === "select") {
    return (
      <Field className={cn(isWideField && "desktop:col-span-2")}>
        <FieldLabel htmlFor={field.id}>{field.label}</FieldLabel>
        <FieldContent>
          <OptionSelect
            id={field.id}
            size="default"
            value={typeof value === "string" ? value : ""}
            onChange={onChange}
            options={field.options ?? []}
          />
          {field.helpText ? (
            <FieldDescription>{field.helpText}</FieldDescription>
          ) : null}
        </FieldContent>
      </Field>
    );
  }

  return (
    <Field className={cn(isWideField && "desktop:col-span-2")}>
      <FieldLabel htmlFor={field.id}>{field.label}</FieldLabel>
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
          onFocus={() => {
            if (
              field.type === "password" &&
              field.secret &&
              value === SAVED_SECRET_MASK
            ) {
              onChange("");
            }
          }}
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
        {field.helpText ? (
          <FieldDescription>{field.helpText}</FieldDescription>
        ) : null}
      </FieldContent>
    </Field>
  );
}

export { ConnectorFieldInput };
