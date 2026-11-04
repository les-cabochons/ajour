import { describe, expect, it } from "vitest";
import { EXIT } from "./errors.ts";
import { parseDuration, resolveTask, type ProjectRef } from "./refs.ts";

const projects: ProjectRef[] = [
  {
    projectId: "p-acme",
    name: "Acme Platform",
    code: "ACME",
    tasks: [
      { taskId: "t-meet", name: "03 Meetings" },
      { taskId: "t-backend", name: "05 Backend", pinnedSlot: 1 },
      { taskId: "t-review-acme", name: "08 Code review" },
    ],
  },
  {
    projectId: "p-ajr",
    name: "Ajour Desktop",
    code: "AJR",
    tasks: [
      { taskId: "t-review", name: "04 Review" },
      { taskId: "t-export", name: "07 Export", pinnedSlot: 10 },
    ],
  },
  {
    projectId: "p-reunion",
    name: "Réunions",
    tasks: [{ taskId: "t-weekly", name: "Hebdo équipe" }],
  },
];

function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error as { exitCode: number; message: string };
  }
  throw new Error("Expected a failure.");
}

describe("resolveTask", () => {
  it.each([
    ["a task alone, by part of its name", "export", "t-export"],
    ["project code and task", "ajr/review", "t-review"],
    ["the project's name", "acme platform/backend", "t-backend"],
    ["a project prefix", "aj/exp", "t-export"],
    [
      "case, accents and spaces ignored",
      "  REUNIONS / hebdo   EQUIPE ",
      "t-weekly",
    ],
    ["pinned key 1", "1", "t-backend"],
    ["pinned key 0, the tenth", "0", "t-export"],
  ])("finds %s", (_name, query, taskId) => {
    expect(resolveTask(query, projects).taskId).toBe(taskId);
  });

  it("prefers a prefix match over a match inside the name", () => {
    const withPrefix: ProjectRef[] = [
      {
        projectId: "p",
        name: "P",
        tasks: [
          { taskId: "inside", name: "Code review" },
          { taskId: "prefix", name: "Review notes" },
        ],
      },
    ];
    expect(resolveTask("review", withPrefix).taskId).toBe("prefix");
  });

  it("names the candidates when several tasks match, with exit 4", () => {
    const error = failure(() => resolveTask("review", projects));
    expect(error.exitCode).toBe(EXIT.reference);
    expect(error.message).toBe(
      '"review" matches 2 tasks:\n' +
        "  ACME/08 Code review\n" +
        "  AJR/04 Review\n" +
        'Say which, such as: ajour start "AJR/04 Review"',
    );
  });

  it("says when nothing matches, with exit 4", () => {
    const error = failure(() => resolveTask("deploy", projects));
    expect(error.exitCode).toBe(EXIT.reference);
    expect(error.message).toBe('No active task matches "deploy".');
    expect(failure(() => resolveTask("5", projects)).message).toBe(
      "No task is pinned to 5.",
    );
  });
});

describe("parseDuration", () => {
  it.each([
    ["1:30", 90],
    ["0:05", 5],
    ["1.5", 90],
    ["1,5", 90],
    [".25", 15],
    ["1h30", 90],
    ["1h", 60],
    ["2h05", 125],
    ["90m", 90],
    ["45min", 45],
    ["24:00", 1440],
  ])("reads %s as %i minutes", (text, minutes) => {
    expect(parseDuration(text, { allowZero: false })).toBe(minutes);
  });

  it.each(["", "abc", "1:75", "-1", "25h", "24:01", "0"])(
    "refuses %j with exit 2",
    (text) => {
      const error = failure(() => parseDuration(text, { allowZero: false }));
      expect(error.exitCode).toBe(EXIT.usage);
    },
  );

  it("allows zero where the running entry counts from it", () => {
    expect(parseDuration("0", { allowZero: true })).toBe(0);
    expect(parseDuration("0:00", { allowZero: true })).toBe(0);
  });
});
