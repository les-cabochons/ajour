import { useState } from "react";
import { OptionSelect, type SelectOption } from "@/components/ui/option-select";
import type { TimeRoundingMode, TimeRoundingRule } from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import { cn } from "@/lib/utils";
import {
  findTimeRoundingPreset,
  formatTimeRoundingMinimum,
  roundEntryDuration,
  TIME_ROUNDING_MINIMUMS,
  TIME_ROUNDING_PRESETS,
  TIME_ROUNDING_STEPS,
} from "@/domain/time/time-rounding";

const CUSTOM = "custom";
const INHERIT = "inherit";
const MINUTE_MS = 60_000;

/** The direction a custom rule rounds, as its sentence reads. */
const CUSTOM_MODES: SelectOption<Exclude<TimeRoundingMode, "off">>[] = [
  { value: "up", label: "up to" },
  { value: "down", label: "down to" },
  { value: "nearest", label: "to the nearest" },
];
const STEP_OPTIONS: SelectOption[] = TIME_ROUNDING_STEPS.map((step) => ({
  value: String(step),
  label: `${step} min`,
}));

type StepRule = Pick<TimeRoundingRule, "mode" | "stepMinutes">;

/**
 * The Rounding menu: the named rules, then Custom…, which shows "Round [up
 * to] [10 min]" under it. With `inheritLabel`, the menu starts with that
 * choice, such as "Same as Settings · Nearest minute", and `rule` undefined
 * selects it.
 */
export function TimeRoundingSelect({
  id,
  label,
  rule,
  onChange,
  inheritLabel,
  className,
  inline = false,
}: {
  id?: string;
  label?: string;
  rule: StepRule | undefined;
  onChange: (rule: StepRule | undefined) => void;
  inheritLabel?: string;
  /** The menu's trigger. */
  className?: string;
  /** In a properties card: the sentence starts at the value column's edge. */
  inline?: boolean;
}) {
  const preset = rule ? findTimeRoundingPreset(rule) : undefined;
  // Custom… stays open on a rule a preset also names, until another pick.
  const [customPicked, setCustomPicked] = useState(false);
  const custom = rule !== undefined && (customPicked || !preset);
  const value = rule === undefined ? INHERIT : custom ? CUSTOM : preset!.id;
  const options: SelectOption[] = [
    ...(inheritLabel ? [{ value: INHERIT, label: inheritLabel }] : []),
    ...TIME_ROUNDING_PRESETS.map((item) => ({
      value: item.id,
      label: item.label,
    })),
    { value: CUSTOM, label: "Custom…" },
  ];

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-start gap-2",
        inline ? "w-full" : "desktop:items-end",
      )}
    >
      <OptionSelect
        id={id}
        label={label}
        className={className ?? "w-48"}
        value={value}
        options={options}
        onChange={(next) => {
          if (next === INHERIT) {
            setCustomPicked(false);
            onChange(undefined);
          } else if (next === CUSTOM) {
            setCustomPicked(true);
            // From Exact, Custom… starts on a rule that rounds.
            onChange(
              rule && rule.mode !== "off"
                ? rule
                : { mode: "up", stepMinutes: 10 },
            );
          } else {
            setCustomPicked(false);
            const picked = TIME_ROUNDING_PRESETS.find(
              (item) => item.id === next,
            )!;
            onChange({ mode: picked.mode, stepMinutes: picked.stepMinutes });
          }
        }}
      />
      {custom && rule.mode !== "off" ? (
        <div
          role="group"
          aria-label="Custom rounding"
          className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--text-secondary)]"
        >
          <span>Round</span>
          <OptionSelect
            label="Direction"
            className="w-36"
            value={rule.mode}
            options={CUSTOM_MODES}
            onChange={(mode) => onChange({ ...rule, mode })}
          />
          <OptionSelect
            label="Step"
            className="w-24"
            value={String(rule.stepMinutes)}
            options={STEP_OPTIONS}
            onChange={(step) =>
              onChange({ ...rule, stepMinutes: Number(step) })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

const MINIMUM_OPTIONS: SelectOption[] = TIME_ROUNDING_MINIMUMS.map(
  (minutes) => ({
    value: String(minutes),
    label: formatTimeRoundingMinimum(minutes),
  }),
);

/** The Minimum per entry menu: None, 5 min … 1 h. */
export function TimeRoundingMinimumSelect({
  id,
  label,
  minimumMinutes,
  onChange,
  className,
}: {
  id?: string;
  label?: string;
  minimumMinutes: number;
  onChange: (minimumMinutes: number) => void;
  className?: string;
}) {
  return (
    <OptionSelect
      id={id}
      label={label}
      className={className ?? "w-28"}
      value={String(minimumMinutes)}
      options={MINIMUM_OPTIONS}
      onChange={(minutes) => onChange(Number(minutes))}
    />
  );
}

/** Two sample timers, a short and a long one. */
const SAMPLES_MS = [7 * MINUTE_MS, 52 * MINUTE_MS];

/**
 * "0:07 saves as 0:15 · 0:52 as 1:00": what two sample timers save as under
 * a rule, or undefined when the rule leaves both as they are.
 */
export function describeTimeRoundingSamples(
  rule: TimeRoundingRule,
): string | undefined {
  const saved = SAMPLES_MS.map((ms) => roundEntryDuration(ms, rule));
  if (saved.every((ms, index) => ms === SAMPLES_MS[index])) return undefined;
  const [first, second] = SAMPLES_MS.map((ms, index) => ({
    from: formatClockDuration(ms),
    to: formatClockDuration(saved[index]!),
  }));
  return `${first!.from} saves as ${first!.to} · ${second!.from} as ${second!.to}`;
}
