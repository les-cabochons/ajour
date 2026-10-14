import type {
  ComponentProps,
  ComponentType,
  ElementType,
  ReactNode,
} from "react";

import { RiCheckboxCircleLine as CheckCircle } from "@remixicon/react";

import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string }>;

function AppPanel({
  as,
  className,
  ...props
}: ComponentProps<"div"> & { as?: ElementType }) {
  const Surface = as ?? "div";
  return <Surface className={cn("settings-panel", className)} {...props} />;
}

/**
 * One setting: a label and an optional description on the leading side, the
 * control on the trailing side. Rows carry no border or background; spacing
 * and type size separate them. `stacked` puts the control under the text,
 * for wide controls such as selects and inputs.
 */
function SettingRow({
  label,
  labelFor,
  description,
  children,
  stacked = false,
  className,
}: {
  label: ReactNode;
  labelFor?: string;
  description?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
  className?: string;
}) {
  const Label = labelFor ? "label" : "div";
  return (
    <div
      className={cn("settings-row", className)}
      data-stacked={stacked ? "" : undefined}
    >
      <div className="settings-row-text">
        <Label className="settings-row-label" htmlFor={labelFor}>
          {label}
        </Label>
        {description ? (
          <div className="settings-row-desc">{description}</div>
        ) : null}
      </div>
      {children ? <div className="settings-row-control">{children}</div> : null}
    </div>
  );
}

/** A finished action's result, as a plain line with a check icon. */
function ResultLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
      <CheckCircle className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function MessagePanel({
  className,
  tone = "default",
  ...props
}: ComponentProps<"div"> & { tone?: "default" | "warning" }) {
  return (
    <div
      className={cn(
        "message-panel",
        tone === "warning" && "message-panel-warning",
        className,
      )}
      {...props}
    />
  );
}

function SurfaceCallout({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: IconType;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export { AppPanel, MessagePanel, ResultLine, SettingRow, SurfaceCallout };
