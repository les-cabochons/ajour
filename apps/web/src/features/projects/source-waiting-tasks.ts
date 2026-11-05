import { showActionToast, showToast } from "@/components/ui/toast";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { getTaskNameField } from "@/domain/projects/plugin-properties";
import type { SourceWaitingQuestion } from "@/domain/projects/source-sync";
import { requestWaitingTaskAnswers } from "@/features/projects/waiting-tasks-dialog";
import { localStore } from "@/lib/local-store";
import { listTaskPropertyPlugins } from "@/lib/plugin-project-properties";

/*
 * The #481 question after a project source sync added tasks to a project
 * with Not known yet tasks (#505). A manual sync asks at once; an automatic
 * one offers it from a toast, so nothing opens while the user works.
 */

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** The plugin's name for the timesheet tool, such as Workday. */
async function timesheetToolName() {
  const plugins = await listTaskPropertyPlugins().catch(() => []);
  return (
    plugins.find((plugin) => getTaskNameField(plugin))?.capability.section ??
    "timesheet"
  );
}

/**
 * Asks, one project at a time, which new task each waiting task waited for,
 * and applies the answers. Returns how many waiting tasks became their
 * source task. A cancelled question changes nothing for its project.
 */
export async function askSourceWaitingQuestions(
  sourceLabel: string,
  questions: readonly SourceWaitingQuestion[],
): Promise<number> {
  const toolName = await timesheetToolName();
  let matched = 0;
  for (const question of questions) {
    const project = localStore
      .snapshot()
      .projects.find((entry) => entry._id === question.projectId);
    if (!project) continue;
    const answers = await requestWaitingTaskAnswers(
      question.choices,
      toolName,
      {
        description: `${sourceLabel} added new tasks to ${getLocalProjectDisplayName(project)}. Pick the one each task was waiting for. Ajour links it, so its time and backlog items stay on it.`,
        newGroupLabel: `New in ${sourceLabel}`,
        confirmLabel: "Apply",
      },
    );
    if (!answers) continue;
    matched += localStore.answerSourceWaitingTasks(question.projectId, answers);
  }
  return matched;
}

/** Asks now, then says how many waiting tasks matched. */
export async function askAndReportSourceWaitingQuestions(
  sourceLabel: string,
  questions: readonly SourceWaitingQuestion[],
) {
  if (questions.length === 0) return;
  const matched = await askSourceWaitingQuestions(sourceLabel, questions);
  if (matched > 0) {
    showToast(`Matched ${plural(matched, "waiting task", "waiting tasks")}.`);
  }
}

/** Offers the question from a toast, after an automatic sync. */
export function offerSourceWaitingQuestions(
  sourceLabel: string,
  questions: readonly SourceWaitingQuestion[],
) {
  const count = questions.reduce(
    (sum, question) => sum + question.choices.length,
    0,
  );
  if (count === 0) return;
  showActionToast({
    title: `${sourceLabel} added tasks. ${plural(count, "task is", "tasks are")} still Not known yet.`,
    actionLabel: "Match",
    onAction: () =>
      void askAndReportSourceWaitingQuestions(sourceLabel, questions),
  });
}
