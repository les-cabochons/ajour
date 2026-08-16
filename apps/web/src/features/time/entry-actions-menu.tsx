import { useState } from "react";
import {
  RiArrowLeftLine as ArrowLeft,
  RiCalendarEventLine as CalendarClock,
  RiFileCopyLine as Copy,
  RiMore2Line as MoreVertical,
  RiShareForwardLine as MoveRight,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

type DateAction = "duplicate" | "move";

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatIsoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

export function EntryActionsMenu({
  currentDate,
  disabled = false,
  onDuplicate,
  onDuplicateTo,
  onMoveTo,
}: {
  currentDate: string;
  disabled?: boolean;
  onDuplicate: () => void;
  onDuplicateTo: (localDate: string) => void;
  onMoveTo: (localDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dateAction, setDateAction] = useState<DateAction | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => dateAtNoon(currentDate));

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setDateAction(null);
    }
  }

  function openDateAction(action: DateAction) {
    setSelectedDate(dateAtNoon(currentDate));
    setDateAction(action);
  }

  function duplicateEntry() {
    setOpen(false);
    onDuplicate();
  }

  function confirmDateAction() {
    const localDate = formatIsoDate(selectedDate);
    setOpen(false);
    if (dateAction === "duplicate") {
      onDuplicateTo(localDate);
    } else if (dateAction === "move") {
      onMoveTo(localDate);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && dateAction !== null && eventDetails.reason === "escape-key") {
          eventDetails.cancel();
          setDateAction(null);
          return;
        }
        handleOpenChange(nextOpen);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Entry options"
            title="Entry options"
          />
        }
      >
        <MoreVertical />
      </PopoverTrigger>
      <PopoverContent
        className="entry-actions-menu-layer entry-actions-popover"
        align="end"
        side="bottom"
      >
        {dateAction === null ? (
          <>
            <PopoverHeader className="sr-only">
              <PopoverTitle>Entry options</PopoverTitle>
              <PopoverDescription>Duplicate or move this time entry.</PopoverDescription>
            </PopoverHeader>
            <div className="entry-actions-list" role="group" aria-label="Entry options">
              <Button type="button" variant="ghost" size="sm" onClick={duplicateEntry}>
                <Copy data-icon="inline-start" />
                Duplicate
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openDateAction("duplicate")}
              >
                <CalendarClock data-icon="inline-start" />
                Duplicate to…
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openDateAction("move")}
              >
                <MoveRight data-icon="inline-start" />
                Move to…
              </Button>
            </div>
          </>
        ) : (
          <>
            <PopoverHeader className="entry-actions-calendar-header">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Back to entry options"
                onClick={() => setDateAction(null)}
              >
                <ArrowLeft />
              </Button>
              <div>
                <PopoverTitle>
                  {dateAction === "move" ? "Move time entry" : "Duplicate time entry"}
                </PopoverTitle>
                <PopoverDescription>Choose the destination date.</PopoverDescription>
              </div>
            </PopoverHeader>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
            />
            <div className="entry-actions-calendar-footer">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDateAction(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={confirmDateAction}>
                {dateAction === "move" ? "Move" : "Duplicate"}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
