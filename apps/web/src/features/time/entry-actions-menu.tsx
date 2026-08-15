import { useState } from "react";
import {
  RiCalendarEventLine as CalendarClock,
  RiFileCopyLine as Copy,
  RiMore2Line as MoreVertical,
  RiShareForwardLine as MoveRight,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const [dateAction, setDateAction] = useState<DateAction | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => dateAtNoon(currentDate));

  function openDateAction(action: DateAction) {
    setSelectedDate(dateAtNoon(currentDate));
    setDateAction(action);
  }

  function confirmDateAction() {
    const localDate = formatIsoDate(selectedDate);
    if (dateAction === "duplicate") {
      onDuplicateTo(localDate);
    } else if (dateAction === "move") {
      onMoveTo(localDate);
    }
    setDateAction(null);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Entry actions"
            />
          }
        >
          <MoreVertical data-icon="inline-start" />
          Entry actions
        </DropdownMenuTrigger>
        <DropdownMenuContent className="entry-actions-menu-layer" align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDateAction("duplicate")}>
              <CalendarClock />
              Duplicate to…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDateAction("move")}>
              <MoveRight />
              Move to…
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dateAction !== null}
        onOpenChange={(open) => !open && setDateAction(null)}
      >
        <DialogContent
          className="entry-actions-menu-layer max-w-sm gap-4"
          overlayClassName="entry-actions-menu-layer"
        >
          <DialogHeader>
            <DialogTitle>
              {dateAction === "move" ? "Move time entry" : "Duplicate time entry"}
            </DialogTitle>
            <DialogDescription>
              Choose the destination date.
            </DialogDescription>
          </DialogHeader>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => date && setSelectedDate(date)}
            className="mx-auto"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDateAction(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmDateAction}>
              {dateAction === "move" ? "Move" : "Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
