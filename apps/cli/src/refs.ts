import { normalizeTaskName } from "../../../packages/shared/task-names.ts";
import { CliError, EXIT, UsageError } from "./errors.ts";

/**
 * Turns what the user typed into what Ajour's tools take: a task, a
 * duration. Pure: the lists come from Ajour's read tools.
 */

/** A reference that matched nothing or several things. */
export class ReferenceError extends CliError {
  constructor(message: string) {
    super(message, EXIT.reference, "error");
  }
}

export interface ProjectRef {
  projectId: string;
  /** The project's display name. */
  name: string;
  code?: string;
  tasks: readonly { taskId: string; name: string; pinnedSlot?: number }[];
}

export interface ResolvedTask {
  projectId: string;
  taskId: string;
  /** "AJR/07 Export", for messages. */
  label: string;
}

type Tier = "exact" | "prefix" | "inside";
const TIERS: readonly Tier[] = ["exact", "prefix", "inside"];

function tierOf(candidate: string, query: string): Tier | undefined {
  const name = normalizeTaskName(candidate);
  if (name === query) return "exact";
  if (name.startsWith(query)) return "prefix";
  if (name.includes(query)) return "inside";
  return undefined;
}

/** The best tier's matches: an exact name wins, then a prefix, then a part. */
function bestMatches<T>(
  items: readonly T[],
  query: string,
  names: (item: T) => (string | undefined)[],
): T[] {
  const tiered = items.map((item) => {
    const tiers = names(item)
      .filter((name): name is string => Boolean(name))
      .map((name) => tierOf(name, query))
      .filter((tier): tier is Tier => tier !== undefined);
    return {
      item,
      tier: TIERS.find((tier) => tiers.includes(tier)),
    };
  });
  for (const tier of TIERS) {
    const found = tiered.filter((entry) => entry.tier === tier);
    if (found.length) return found.map((entry) => entry.item);
  }
  return [];
}

function labelOf(project: ProjectRef, taskName: string): string {
  return `${project.code?.trim() || project.name}/${taskName}`;
}

/**
 * Finds one active task from `PROJECT/TASK`, `TASK`, or a pinned key 1 to 0.
 * PROJECT matches the code, then the name. Names compare as task imports do:
 * trimmed, spaces collapsed, case and accents ignored. Throws exit 4 when
 * nothing or more than one task matches.
 */
export function resolveTask(
  query: string,
  projects: readonly ProjectRef[],
): ResolvedTask {
  const typed = query.trim();
  if (/^\d$/.test(typed)) {
    const slot = typed === "0" ? 10 : Number(typed);
    for (const project of projects) {
      const task = project.tasks.find((item) => item.pinnedSlot === slot);
      if (task) {
        return {
          projectId: project.projectId,
          taskId: task.taskId,
          label: labelOf(project, task.name),
        };
      }
    }
    throw new ReferenceError(`No task is pinned to ${typed}.`);
  }

  const slash = typed.indexOf("/");
  const projectQuery =
    slash >= 0 ? normalizeTaskName(typed.slice(0, slash)) : undefined;
  const taskQuery = normalizeTaskName(
    slash >= 0 ? typed.slice(slash + 1) : typed,
  );
  if (!taskQuery || projectQuery === "") {
    throw new UsageError(`"${typed}" isn't a task. Use TASK or PROJECT/TASK.`);
  }

  const inProjects =
    projectQuery === undefined
      ? projects
      : bestMatches(projects, projectQuery, (project) => [
          project.code,
          project.name,
        ]);
  const tasks = inProjects.flatMap((project) =>
    project.tasks.map((task) => ({ project, task })),
  );
  const matches = bestMatches(tasks, taskQuery, ({ task }) => [task.name]);

  if (matches.length === 1) {
    const [{ project, task }] = matches as [(typeof matches)[number]];
    return {
      projectId: project.projectId,
      taskId: task.taskId,
      label: labelOf(project, task.name),
    };
  }
  if (matches.length === 0) {
    throw new ReferenceError(`No active task matches "${typed}".`);
  }
  const labels = matches
    .map(({ project, task }) => labelOf(project, task.name))
    .sort((left, right) => left.localeCompare(right));
  const example = labels.at(-1)!;
  throw new ReferenceError(
    `"${typed}" matches ${labels.length} tasks:\n` +
      labels.map((label) => `  ${label}`).join("\n") +
      `\nSay which, such as: ajour start ${/\s/.test(example) ? `"${example}"` : example}`,
  );
}

const MAX_MINUTES = 24 * 60;

/**
 * Reads a duration as whole minutes: "1:30", "1.5" or "1,5" hours, "1h30",
 * "2h", "90m" or "45min". Up to 24 hours. Zero only where the running entry
 * counts on from it.
 */
export function parseDuration(
  text: string,
  options: { allowZero: boolean },
): number {
  const minutes = readMinutes(text.trim().toLowerCase());
  const lowest = options.allowZero ? 0 : 1;
  if (minutes === undefined || minutes < lowest || minutes > MAX_MINUTES) {
    throw new UsageError(
      `--duration takes a time such as 1:30, 1h30, 90m or 1.5, from ${options.allowZero ? "0:00" : "1 minute"} to 24 hours, not "${text}"`,
    );
  }
  return minutes;
}

function readMinutes(text: string): number | undefined {
  const clock = /^(\d+):(\d{2})$/.exec(text);
  if (clock) {
    const minutes = Number(clock[2]);
    return minutes < 60 ? Number(clock[1]) * 60 + minutes : undefined;
  }
  const hoursAndMinutes = /^(\d+)h(?:(\d{1,2})(?:m|min)?)?$/.exec(text);
  if (hoursAndMinutes) {
    const minutes = Number(hoursAndMinutes[2] ?? 0);
    return minutes < 60 ? Number(hoursAndMinutes[1]) * 60 + minutes : undefined;
  }
  const minutesOnly = /^(\d+)(?:m|min)$/.exec(text);
  if (minutesOnly) return Number(minutesOnly[1]);
  const decimal = /^(\d*)[.,]?(\d*)$/.exec(text);
  if (decimal && /\d/.test(text)) {
    const hours = Number(`${decimal[1] || "0"}.${decimal[2] || "0"}`);
    return Number.isFinite(hours) ? Math.round(hours * 60) : undefined;
  }
  return undefined;
}
