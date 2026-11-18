import { fillTemplate } from "../../../../packages/shared/agent-task-templates.ts";
import type { CoreAgentTask } from "../../../../packages/shared/agent-runs.ts";

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
export const CONVERSATION_PROMPT = `You are helping the user review a pull request in Ajour's Deck: pull request {{pullRequest}}, at head commit {{head}}. Ajour's "ajour" MCP server gives you tools for this pull request at this head only.

Rules:
- Answer in short Markdown, about the code at this head.
- Do not run shell commands and do not edit files.
`;

/** Each core task's own short prompt. Later tickets fill them in. */
export const CORE_TASK_PROMPTS: Readonly<Record<CoreAgentTask, string>> = {
  "deck.guide":
    "Group this pull request's changes into concerns, in the order a reviewer should read them.",
  "deck.ask": "Answer the user's question about this pull request.",
  "deck.chat": "Reply to the user's message about this pull request.",
};

/** The conversation's instructions, filled for its pull request and head. */
export function buildConversationPrompt(binding: {
  pullRequest: string;
  head: string;
}): string {
  return fillTemplate(CONVERSATION_PROMPT, binding);
}

/** One turn: its task's prompt, then the user's own words when given. */
export function buildTurnPrompt(task: CoreAgentTask, message?: string): string {
  return message
    ? `${CORE_TASK_PROMPTS[task]}\n\nThe user's message:\n${message}`
    : CORE_TASK_PROMPTS[task];
}
