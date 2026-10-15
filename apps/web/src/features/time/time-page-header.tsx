import {
  RiArrowGoBackLine as ReturnIcon,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import { PageHeader, PageTitle } from "@/components/page-header";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WeekCommittedBadge } from "@/features/time/commit-week-controls";
import { TimeDatePicker, dateAtNoon } from "@/features/time/time-date-picker";
import { addDaysIsoDate } from "@/lib/utils";

export type TimeView = "day" | "week";

/** "October 12–18", or "September 29–October 5" across a month boundary. */
export function formatWeekRange(weekDates: string[]) {
  const start = weekDates[0];
  const end = weekDates.at(-1);
  if (!start || !end) return "";
  const startDate = dateAtNoon(start);
  const endDate = dateAtNoon(end);
  const startLabel = new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-CA", {
    month: startDate.getMonth() === endDate.getMonth() ? undefined : "long",
    day: "numeric",
  }).format(endDate);
  return `${startLabel}–${endLabel}`;
}

/**
 * The Time page's top bar: previous and next, the day (a calendar trigger) or
 * the week's range, a Today chip or the way back to today, then Day | Week.
 */
export function TimePageHeader({
  date,
  today,
  view,
  weekDates,
  weekAvailable,
  onSelectDate,
  onChangeView,
}: {
  date: string;
  today: string;
  view: TimeView;
  weekDates: string[];
  /** Week needs a desktop width; without it the switcher is not offered. */
  weekAvailable: boolean;
  onSelectDate: (date: string) => void;
  onChangeView: (view: TimeView) => void;
}) {
  const step = view === "week" ? 7 : 1;
  const unit = view === "week" ? "week" : "day";
  const showsToday =
    view === "week" ? weekDates.includes(today) : date === today;

  return (
    <PageHeader
      actions={
        weekAvailable ? (
          <ToggleGroup
            value={[view]}
            onValueChange={(values) => {
              const next = values[0];
              if ((next === "day" || next === "week") && next !== view) {
                onChangeView(next);
              }
            }}
            variant="outline"
            aria-label="Time view"
          >
            <ToggleGroupItem value="day">Day</ToggleGroupItem>
            <ToggleGroupItem value="week">Week</ToggleGroupItem>
          </ToggleGroup>
        ) : null
      }
    >
      <span className="ajour-page-header-nav">
        <TooltipButton
          label={`Previous ${unit}`}
          shortcut="time.previous"
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onSelectDate(addDaysIsoDate(date, -step))}
            />
          }
        >
          <ChevronLeft />
        </TooltipButton>
        <TooltipButton
          label={`Next ${unit}`}
          shortcut="time.next"
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onSelectDate(addDaysIsoDate(date, step))}
            />
          }
        >
          <ChevronRight />
        </TooltipButton>
      </span>
      {view === "week" ? (
        <PageTitle>{formatWeekRange(weekDates)}</PageTitle>
      ) : (
        <TimeDatePicker date={date} onSelectDate={onSelectDate} long />
      )}
      {showsToday ? (
        <Chip>Today</Chip>
      ) : (
        <TooltipButton
          label="Return to today"
          shortcut="time.today"
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => onSelectDate(today)}
            />
          }
        >
          <ReturnIcon className="size-3.5" />
        </TooltipButton>
      )}
      {view === "week" ? <WeekCommittedBadge weekDates={weekDates} /> : null}
    </PageHeader>
  );
}
