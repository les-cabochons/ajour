import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OptionSelect } from "@/components/ui/option-select";
import type {
  WaitingTaskAnswer,
  WaitingTaskChoice,
} from "@/domain/projects/project-import";
import { normalizeTaskImportName } from "@/domain/projects/task-import";

/*
 * Import tasks… asks, before it writes anything, which new task of the file
 * each Not known yet task waited for (#481). A pick renames the task, so its
 * time and backlog items stay on it.
 */

interface WaitingTasksRequest {
  choices: WaitingTaskChoice[];
  /** The plugin's name for the timesheet tool, such as Workday. */
  toolName: string;
  resolve: (answers: Record<string, WaitingTaskAnswer> | null) => void;
}

let requestListener: ((request: WaitingTasksRequest) => void) | null = null;

/**
 * Asks about the choices. Resolves to an answer per task, or null when the
 * user cancels, which imports nothing. Without a mounted host every task
 * stays waiting.
 */
export function requestWaitingTaskAnswers(
  choices: WaitingTaskChoice[],
  toolName: string,
): Promise<Record<string, WaitingTaskAnswer> | null> {
  return new Promise((resolve) => {
    if (!requestListener) {
      resolve(
        Object.fromEntries(
          choices.map((choice) => [
            choice.taskId,
            { kind: "wait" as const, expectedName: choice.name },
          ]),
        ),
      );
      return;
    }
    requestListener({ choices, toolName, resolve });
  });
}

const WAIT = "\u0000wait";
const LOCAL = "\u0000local";

/**
 * The first new name when it shares a word with the task's, else Still
 * waiting: a guess that names nothing in common is no guess.
 */
function suggest(choice: WaitingTaskChoice) {
  const words = new Set(normalizeTaskImportName(choice.name).split(" "));
  const first = choice.newNames[0];
  return first &&
    normalizeTaskImportName(first)
      .split(" ")
      .some((word) => words.has(word))
    ? first
    : WAIT;
}

/** The "N tasks are waiting for their Workday task" dialog. Mounted once in the app shell. */
export function WaitingTasksDialogHost() {
  const [request, setRequest] = useState<WaitingTasksRequest | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});

  useEffect(() => {
    const listener = (next: WaitingTasksRequest) => {
      setPicks(
        Object.fromEntries(
          next.choices.map((choice) => [choice.taskId, suggest(choice)]),
        ),
      );
      setRequest((current) => {
        current?.resolve(null);
        return next;
      });
    };
    requestListener = listener;
    return () => {
      if (requestListener === listener) requestListener = null;
    };
  }, []);

  function answer(confirmed: boolean) {
    if (!request) return;
    request.resolve(
      confirmed
        ? Object.fromEntries(
            request.choices.map((choice): [string, WaitingTaskAnswer] => {
              const pick = picks[choice.taskId] ?? WAIT;
              // The name seen here: a task renamed meanwhile takes no answer.
              const expectedName = choice.name;
              return [
                choice.taskId,
                pick === WAIT
                  ? { kind: "wait", expectedName }
                  : pick === LOCAL
                    ? { kind: "local", expectedName }
                    : { kind: "rename", name: pick, expectedName },
              ];
            }),
          )
        : null,
    );
    setRequest(null);
  }

  const count = request?.choices.length ?? 0;
  // A new name renames one task at most, so a second pick of it is refused.
  const picked = Object.values(picks).filter(
    (pick) => pick !== WAIT && pick !== LOCAL,
  );
  const twice = picked.length !== new Set(picked).size;

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => !open && answer(false)}
    >
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader className="gap-1">
          <DialogTitle>
            {count === 1
              ? `1 task is waiting for its ${request?.toolName} task`
              : `${count} tasks are waiting for their ${request?.toolName} task`}
          </DialogTitle>
          <DialogDescription>
            This file adds new tasks. Pick the one each task was waiting for.
            Ajour renames it, so its time and backlog items stay on it.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {request?.choices.map((choice) => (
            <li
              key={choice.taskId}
              className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] items-center gap-2 text-[13px]"
            >
              <span className="truncate">{choice.name}</span>
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
              <OptionSelect
                label={`${choice.name} was waiting for`}
                value={picks[choice.taskId] ?? WAIT}
                onChange={(pick) =>
                  setPicks((current) => ({
                    ...current,
                    [choice.taskId]: pick,
                  }))
                }
                groups={[
                  {
                    label: "New in this file",
                    options: choice.newNames.map((name) => ({
                      value: name,
                      label: name,
                    })),
                  },
                  {
                    label: "Not yet",
                    options: [
                      { value: WAIT, label: "Still waiting" },
                      { value: LOCAL, label: "Local only" },
                    ],
                  },
                ]}
              />
            </li>
          ))}
        </ul>
        {twice ? (
          <p className="text-xs text-[var(--warning)]">
            Pick each new task for one task only.
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={twice} onClick={() => answer(true)}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
