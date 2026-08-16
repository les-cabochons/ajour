import { RiArrowDownSLine as ChevronDown, RiCheckLine as Check } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type TimeViewScope = "day" | "week";

export function TimeViewScopeMenu({
  value,
  onChange,
}: {
  value: TimeViewScope;
  onChange: (value: TimeViewScope) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="day-viewer-date-scope-trigger"
            aria-label={`Time view: ${value === "day" ? "Day" : "Weeks"}`}
            title="Change time view"
          />
        }
      >
        <ChevronDown data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent className="time-view-scope-popover" align="start" sideOffset={8}>
        <PopoverHeader className="sr-only">
          <PopoverTitle>Time view</PopoverTitle>
          <PopoverDescription>Choose Day or Weeks.</PopoverDescription>
        </PopoverHeader>
        <ToggleGroup
          value={[value]}
          onValueChange={(nextValue) => {
            const nextScope = nextValue[0] as TimeViewScope | undefined;
            if (nextScope && nextScope !== value) {
              onChange(nextScope);
            }
          }}
          orientation="vertical"
          variant="default"
          size="sm"
          aria-label="Time view"
          className="time-view-scope-options"
        >
          <ToggleGroupItem value="day" className="time-view-scope-option">
            <Check data-icon="inline-start" className="time-view-scope-check" />
            <span>Day</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="week" className="time-view-scope-option">
            <Check data-icon="inline-start" className="time-view-scope-check" />
            <span>Weeks</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}
