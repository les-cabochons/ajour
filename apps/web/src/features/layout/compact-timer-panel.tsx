import { useState } from "react";
import { RiExternalLinkLine, RiSearchLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Value } from "@/components/ui/value";
import {
  PanelHeader,
  PanelTimer,
} from "@/features/layout/compact-timer-controls";
import { PanelTasks } from "@/features/layout/compact-timer-tasks";
import { PanelDays } from "@/features/layout/compact-timer-days";
import { TodayTotal } from "@/features/layout/timer-dock";
import {
  TimeEntryEditorForm,
  type TimeEntryEditorTarget,
} from "@/features/time/time-entry-editor-form";
import { useTodayIsoDate } from "@/lib/use-now";

export function CompactTimerPanel({
  onOpenTask,
  onOpenApp,
  onDismiss,
}: {
  onOpenTask: (id: string) => void;
  onOpenApp: () => void;
  onDismiss: () => void;
}) {
  const [view, setView] = useState("tasks");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<TimeEntryEditorTarget | null>(null);
  const today = useTodayIsoDate();
  return (
    <div
      className="flex h-dvh min-h-0 flex-col bg-background text-foreground"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !editor) {
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      <PanelHeader today={today} />
      <PanelTimer onEdit={setEditor} disabled={editor !== null} />
      {editor ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TimeEntryEditorForm
            key={
              editor.kind === "create"
                ? `new-${editor.initialValues?.workItemId ?? ""}`
                : editor.kind === "running"
                  ? editor.timer._id
                  : editor.entry._id
            }
            target={editor}
            host="popover"
            onClose={() => setEditor(null)}
          />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 px-2.5 pt-3 pb-1.5">
            <div className="relative min-w-0 flex-1">
              <RiSearchLine className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground" />
              <Input
                type="search"
                aria-label={
                  view === "tasks" ? "Search tasks" : "Search entries"
                }
                placeholder={
                  view === "tasks" ? "Search tasks" : "Search entries"
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-7"
              />
            </div>
            <ToggleGroup
              variant="outline"
              value={[view]}
              onValueChange={(value) => {
                if (value[0]) {
                  setView(value[0]);
                  setQuery("");
                }
              }}
              aria-label="Panel view"
            >
              <ToggleGroupItem value="tasks" className="px-2 text-xs">
                Tasks
              </ToggleGroupItem>
              <ToggleGroupItem value="today" className="px-2 text-xs">
                Today
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {view === "tasks" ? (
              <PanelTasks
                query={query}
                onEdit={setEditor}
                onOpenTask={onOpenTask}
              />
            ) : (
              <PanelDays query={query} onEdit={setEditor} />
            )}
          </div>
        </>
      )}
      <footer className="flex h-10 shrink-0 items-center justify-between border-t bg-secondary px-3 text-xs text-muted-foreground">
        <span>
          Today{" "}
          <Value className="ml-1.5">
            <TodayTotal />
          </Value>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenApp}
          className="gap-1.5 text-xs"
        >
          Open Ajour
          <RiExternalLinkLine className="size-3" />
        </Button>
      </footer>
    </div>
  );
}
