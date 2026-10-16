import {
  getLocalProjectDisplayName,
  type LocalProject,
} from "@/domain/local-state";
import type { CalendarSuggestion } from "@/domain/time/calendar-suggestions";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

/** "09:00 – 09:15", "09:00–09:15" when `compact`, or "All day". */
export function formatSuggestionTime(
  suggestion: Pick<CalendarSuggestion, "allDay" | "startsAt" | "endsAt">,
  { compact = false } = {},
) {
  return suggestion.allDay
    ? "All day"
    : [
        timeFormat.format(suggestion.startsAt),
        timeFormat.format(suggestion.endsAt),
      ].join(compact ? "–" : " – ");
}

/** The project and task names and color of a suggestion, if the project exists. */
export function projectTaskLabel(
  projects: readonly LocalProject[],
  projectId: string | undefined,
  taskId: string | undefined,
) {
  const project = projects.find((item) => item._id === projectId);
  if (!project) return undefined;
  const task = project.tasks.find((item) => item._id === taskId);
  const name = getLocalProjectDisplayName(project);
  return { name, task: task?.name, color: project.color };
}
