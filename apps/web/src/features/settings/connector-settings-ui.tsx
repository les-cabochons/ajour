import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  ConnectorField,
  ConnectorFieldValue,
  ConnectorPluginManifest,
} from "@ajour/shared";
import { SAVED_SECRET_MASK } from "./connector-form-state";

function ConnectorPluginIcon({
  plugin,
  className,
  imageClassName,
}: {
  plugin: ConnectorPluginManifest;
  className?: string;
  imageClassName?: string;
}) {
  const iconSource = `data:image/svg+xml,${encodeURIComponent(plugin.iconSvg)}`;

  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/60 text-foreground",
        className,
      )}
      aria-hidden="true"
    >
      <img className={cn("size-5", imageClassName)} src={iconSource} alt="" />
    </span>
  );
}

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
      <Field
        orientation="horizontal"
        className="rounded-3xl border border-border/60 bg-muted/10 p-4 md:col-span-2"
      >
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
      <Field className={cn(isWideField && "md:col-span-2")}>
        <FieldLabel htmlFor={field.id}>{field.label}</FieldLabel>
        <FieldContent>
          <NativeSelect
            id={field.id}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          >
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          {field.helpText ? (
            <FieldDescription>{field.helpText}</FieldDescription>
          ) : null}
        </FieldContent>
      </Field>
    );
  }

  return (
    <Field className={cn(isWideField && "md:col-span-2")}>
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

function ConnectorMessageCard({
  label,
  message,
  destructive = false,
}: {
  label: string;
  message: string;
  destructive?: boolean;
}) {
  return (
    <Card
      size="sm"
      className={cn(
        "gap-3",
        destructive && "border border-destructive/30 bg-destructive/5",
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Badge variant={destructive ? "destructive" : "secondary"}>
            {label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

export { ConnectorFieldInput, ConnectorMessageCard, ConnectorPluginIcon };
