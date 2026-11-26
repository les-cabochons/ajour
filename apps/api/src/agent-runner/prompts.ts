import { fillTemplate } from "../../../../packages/shared/agent-task-templates.ts";
import type { CoreAgentTask } from "../../../../packages/shared/agent-runs.ts";
import { deckPullRequestLabel } from "../../../../packages/shared/deck.ts";

/** Ajour's rules for every run. The task prompt follows it. */
export const RUNNER_PROMPT = `You are running a task for Ajour, the user's time tracker. You have two MCP servers: "ajour" for the user's Ajour data and "playwright" for a Chrome window.

Rules:
- Use the Ajour session {{sessionId}}. Ajour already began it. Send update_session at least every few minutes with what you are doing, and always end it with end_session and a short summary.
- Ask the user only when you cannot go on. Use ask with choices, then wait_for_answer.
- Never type a password, a one-time code or any other secret, and never approve a sign-in for the user. When a sign-in page shows, follow the task's sign-in steps if it gives any: they may let you pick an account or type a username. As soon as the page asks for a password, a code or an approval, ask the user to sign in in the Chrome window, with the choices "Done" and "Stop", and wait.
- After the external tool saved a change that get_week_changes returned, call mark_entries_committed with its entry ID and the version get_week_changes gave you. Never mark a change you did not apply. Fixing an external entry back to its committed values, for example when you check a week before submitting it, needs no mark.
- Call submit_week only when the task asks for it, as its last step. It locks the week in Ajour.
- Do not run shell commands and do not edit files.

The task follows.
`;

/** The runner prompt, then the task prompt, with every slot filled. */
export function buildPrompt({
  taskPrompt,
  values,
}: {
  taskPrompt: string;
  values: Record<string, string>;
}): string {
  return fillTemplate(`${RUNNER_PROMPT}\n${taskPrompt}`, values);
}

/**
 * A pull request conversation's own instructions. Each turn adds its task's.
 * No timesheet rules: the conversation sees only its pull request's tools.
 */
export const CONVERSATION_PROMPT = `You are helping the user review a pull request in Ajour's Deck: pull request {{pullRequest}}, at head commit {{head}}. Ajour's "ajour" MCP server gives you tools for this pull request at this head only: read_hunks, read_file, read_threads and read_guide, submit_guide when Ajour asks you to regroup the guide, and, when the user asks in Deck's chat, the review writes they can make. When the head changes, a message says so, and the tools then answer for the new head only.

Rules:
- Answer in short Markdown, about the code at this head. Read the code before you answer, and cite files and lines as \`path:line\`.
- Answer as part of the page the user reads: never name yourself, your model or your provider.
- Do not run shell commands and do not edit files.
`;

/** Each core task's own short prompt. Later tickets fill them in. */
export const CORE_TASK_PROMPTS: Readonly<Record<CoreAgentTask, string>> = {
  "deck.guide": `Regroup this pull request's changes into concerns, in the order a reviewer should read them, and write its summary. Read the hunks you need first. Then call submit_guide once with:
- concerns: 1 to 40, in reading order, each with a title of 80 characters or fewer, a rationale of 300 or fewer saying why its hunks belong together, its hunk ids, and its kinds of change from breaking, feature, fix, refactor, performance, tests, docs, dependencies and build. Every hunk of the guide below goes in exactly one concern.
- summary.problem: what the pull request fixes, in 300 characters or fewer. Write it from the linked ticket, with source "ticket" and the ticket's number, or, when no ticket is linked, infer it from the code with source "inferred".
- summary.breaking: each breaking change, such as to a public API, a schema, a configuration or a behaviour, with its hunk ids. summary.risks: risky areas a reviewer should check, such as migrations, security and auth, data deletion or concurrency, with their hunk ids. Each text 300 characters or fewer; either list may be empty.
When Ajour refuses a submission, fix what it says and call submit_guide again. Once Ajour saved it, reply with one short line and stop.`,
  "deck.ask":
    "Answer the user's question about this pull request in a few short paragraphs, below the part of the page it names. Start with the answer itself, without repeating the question.",
  "deck.chat": `Reply to the user's message about this pull request, in Deck's chat.
You may make the review writes the user asks for in this message, in their name: add_draft_comment adds a comment to their draft review, which they send later; post_comment, reply_to_thread, resolve_thread and submit_review go to the code host at once; edit_title and set_draft change the pull request, only when the user is its author; submit_guide regroups the guide, under its rules, when the user asks you to. Make only the writes the user asked for, never on your own initiative, and prefer a draft comment when they don't say to post. The user sees each write as a line in the chat. Never merge: Ajour has no tool for it, and merging stays the user's own action.`,
};

/** The conversation's instructions, filled for its pull request and head. */
export function buildConversationPrompt(binding: {
  pullRequest: string;
  head: string;
}): string {
  return fillTemplate(CONVERSATION_PROMPT, {
    pullRequest: deckPullRequestLabel(binding.pullRequest),
    head: binding.head,
  });
}

/**
 * One turn: what changed since the last turn, its task's prompt, then the
 * user's own words when given. `headChange` says the pull request's head
 * moved, and `historyLost` that the earlier turns could not be resumed.
 */
export function buildTurnPrompt(
  task: CoreAgentTask,
  message?: string,
  context: {
    headChange?: { from: string; to: string };
    historyLost?: boolean;
    readRoot?: string;
  } = {},
): string {
  const notes = [
    ...(context.historyLost
      ? [
          "Your earlier messages in this conversation could not be restored, so this conversation starts over.",
        ]
      : []),
    ...(context.headChange
      ? [
          `The pull request's head changed from ${context.headChange.from} to ${context.headChange.to}. Ajour's tools now answer for ${context.headChange.to} only, and earlier answers may describe ${context.headChange.from}.`,
        ]
      : []),
    ...(context.readRoot
      ? [
          `For this turn you can also read the whole repository at the pull request's head, in ${context.readRoot}, with your Read, Grep and Glob tools. It is a checkout of that commit for reading only: never try to change it or run anything in it.`,
        ]
      : []),
  ];
  const prompt = message
    ? `${CORE_TASK_PROMPTS[task]}\n\nThe user's message:\n${message}`
    : CORE_TASK_PROMPTS[task];
  return notes.length > 0 ? `${notes.join("\n")}\n\n${prompt}` : prompt;
}
