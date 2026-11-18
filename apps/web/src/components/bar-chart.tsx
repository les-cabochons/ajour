import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * A small stacked bar chart with no chart library: one bar per bucket, its
 * series stacked bottom up, scaled to the tallest bar. Colors are the
 * series' token classes, and a legend names each series with its total, so
 * a color is never read alone. A bar with a value can be a link through
 * `renderBar`; an empty bar is a gap, not a stop for Tab. Hovering or
 * focusing a bar shows its line above the bars, in a row of fixed height.
 */

export interface BarChartSeries {
  id: string;
  label: string;
  /** The segment's background, from the tokens: `bg-destructive`. */
  className: string;
}

export interface BarChartBar {
  key: string;
  /** The bar's line, read when hovered or focused, and its accessible name. */
  label: string;
  /** Each series' value, by its id. */
  values: Readonly<Record<string, number>>;
}

export interface BarChartBarProps {
  className: string;
  "aria-label": string;
  onPointerEnter: () => void;
  onFocus: () => void;
  children: ReactNode;
}

export function BarChart<Bar extends BarChartBar>({
  label,
  series,
  bars,
  idleLine,
  renderBar,
  className,
}: {
  /** The chart's accessible name. */
  label: string;
  series: readonly BarChartSeries[];
  bars: readonly Bar[];
  /** The line above the bars while none is hovered or focused. */
  idleLine: ReactNode;
  /** A bar with a value, such as a link; a `span` by default. */
  renderBar?: (bar: Bar, props: BarChartBarProps) => ReactNode;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const totals = bars.map((bar) =>
    series.reduce((sum, { id }) => sum + (bar.values[id] ?? 0), 0),
  );
  const max = Math.max(0, ...totals);
  const seriesTotals = series.map(({ id }) =>
    bars.reduce((sum, bar) => sum + (bar.values[id] ?? 0), 0),
  );
  const activeBar = active === null ? undefined : bars[active];

  return (
    <figure
      role="group"
      aria-label={label}
      className={cn("m-0 flex min-w-0 flex-col gap-1.5", className)}
    >
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((item, index) => (
          <li key={item.id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("size-2 shrink-0", item.className)}
            />
            {item.label}
            <span className="font-mono text-foreground tabular-nums">
              {seriesTotals[index]!.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
      <p
        className="h-5 truncate text-xs text-muted-foreground"
        data-testid="bar-chart-line"
      >
        {activeBar ? activeBar.label : idleLine}
      </p>
      <div
        className="flex h-16 items-stretch gap-px border-b border-border"
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        {bars.map((bar, index) => {
          const total = totals[index]!;
          const segments = (
            <span
              className="flex w-full flex-col-reverse"
              style={{ height: max > 0 ? `${(total / max) * 100}%` : 0 }}
            >
              {series.map(({ id, className: segmentClass }) => {
                const value = bar.values[id] ?? 0;
                return value > 0 ? (
                  <span
                    key={id}
                    data-series={id}
                    className={cn("block w-full", segmentClass)}
                    style={{ height: `${(value / total) * 100}%` }}
                  />
                ) : null;
              })}
            </span>
          );
          if (total === 0) {
            return (
              <span
                key={bar.key}
                aria-hidden
                className="flex min-w-0 flex-1 items-end"
                onPointerEnter={() => setActive(index)}
              />
            );
          }
          const props: BarChartBarProps = {
            className: "flex min-w-0 flex-1 items-end hover:opacity-80",
            "aria-label": bar.label,
            onPointerEnter: () => setActive(index),
            onFocus: () => setActive(index),
            children: segments,
          };
          return (
            <span key={bar.key} className="contents" data-bar={bar.key}>
              {renderBar ? renderBar(bar, props) : <span {...props} />}
            </span>
          );
        })}
      </div>
    </figure>
  );
}
