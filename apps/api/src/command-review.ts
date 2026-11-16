import type {
  CommandMode,
  UndeclaredCommand,
} from "../../../packages/shared/command-modes.ts";
export interface CommandVerdict {
  verdict: "risky" | "review" | "none";
  ruleId?: string;
  reason?: string;
}
export interface CommandReview {
  review(command: UndeclaredCommand): Promise<CommandVerdict>;
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
