import type {
  CommandMode,
  UndeclaredCommand,
} from "../../../packages/shared/command-modes.ts";
export interface CommandVerdict {
  verdict: "risky" | "review" | "none";
  ruleId?: string;
  reason?: string;
}
/** Where an undeclared command runs, for rules that read its paths. */
export interface CommandReviewContext {
  /** The resolved repository folder, or the system root without one. */
  cwd: string;
  /** The caller's project, which scopes its repository folders. */
  projectId?: string;
}
export interface CommandReview {
  review(
    command: UndeclaredCommand,
    context: CommandReviewContext,
  ): Promise<CommandVerdict>;
}
export const noCommandReview: CommandReview = {
  review: async () => ({ verdict: "none" }),
};
export function commandDecision(
  mode: CommandMode,
  verdict: CommandVerdict["verdict"],
): "ask" | "run" {
  return mode === "always-ask" || (mode === "auto" && verdict === "risky")
    ? "ask"
    : "run";
}
export function sameCommand(a: UndeclaredCommand, b: UndeclaredCommand) {
  return (
    a.executable === b.executable &&
    a.cwdFolder === b.cwdFolder &&
    a.argv.length === b.argv.length &&
    a.argv.every((v, i) => v === b.argv[i])
  );
}
