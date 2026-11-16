import { expect, it } from "vitest";
import { undeclaredCommandSchema } from "../../../packages/shared/command-modes.ts";
import corpus from "./process-rules-corpus.json" with { type: "json" };
import { reviewCommand } from "./process-rules.ts";

/**
 * The regression corpus is #708's 267 command lines
 * (`docs/research/lancet-nano/fixtures.json` on
 * `research/lancet-nano-command-reviewer`), in bash, PowerShell and cmd
 * spellings, converted to the executable and argv the broker receives:
 *
 * - `broker`: the broker accepts the command and the rule table decides it;
 * - `refused`: the undeclared command schema refuses it first (a shell, or
 *   a line break in an argument), and the rule table still marks it;
 * - `not-applicable`: it needs a shell (a pipe, `&&`, `;`, a redirection or
 *   a PowerShell expression), so no plugin can send it to the broker.
 *
 * Home and profile variables are expanded as a plugin would pass the path,
 * and a shell comment stays as arguments. Each command runs in a
 * repository folder.
 */
const contexts = {
  posix: {
    cwd: "/home/dev/code/app",
    repositoryFolders: ["/home/dev/code/app"],
    protectedRoots: [
      "/home/dev/Library/Application Support/Ajour",
      "/Applications/Ajour.app",
    ],
    home: "/home/dev",
  },
  windows: {
    cwd: "C:\\Users\\dev\\code\\app",
    repositoryFolders: ["C:\\Users\\dev\\code\\app"],
    protectedRoots: [
      "C:\\Users\\dev\\AppData\\Roaming\\Ajour",
      "C:\\Users\\dev\\AppData\\Local\\Programs\\Ajour",
      "C:\\Users\\dev\\AppData\\Local\\Ajour\\bin",
    ],
    home: "C:\\Users\\dev",
  },
};
interface Fixture {
  id: string;
  shell: "bash" | "powershell" | "cmd";
  group: string;
  command: string;
  reach: "broker" | "refused" | "not-applicable";
  executable?: string;
  argv?: string[];
  expected?: "risky" | "review" | "none";
  ruleId?: string;
  note?: string;
}
const fixtures = corpus as Fixture[];
const reachable = fixtures.filter((f) => f.reach !== "not-applicable");
/** The history rewrites ticket #717 lists as `review`, not `risky`. */
const REVIEW_RULES = ["git-force-push", "git-discard", "git-branch-delete"];

it("keeps all 267 fixtures, in every shell", () => {
  expect(fixtures).toHaveLength(267);
  const count = (reach: Fixture["reach"]) =>
    fixtures.filter((f) => f.reach === reach).length;
  expect([count("broker"), count("refused"), count("not-applicable")]).toEqual([
    246, 7, 14,
  ]);
});

it.each(reachable.map((f) => [f.id, f.command, f] as const))(
  "%s `%s` gets its recorded verdict",
  (_, __, fixture) => {
    const verdict = reviewCommand({
      ...contexts[fixture.shell === "bash" ? "posix" : "windows"],
      executable: fixture.executable!,
      argv: fixture.argv!,
    });
    expect({ verdict: verdict.verdict, ruleId: verdict.ruleId }).toEqual({
      verdict: fixture.expected,
      ruleId: fixture.ruleId,
    });
    expect(
      undeclaredCommandSchema.safeParse({
        executable: fixture.executable,
        argv: fixture.argv,
      }).success,
    ).toBe(fixture.reach === "broker");
  },
);

it("marks every dangerous fixture risky, or review where the ticket says so", () => {
  const dangerous = reachable.filter(
    (f) => f.group === "dangerous" || f.group === "prompt-injection",
  );
  expect(dangerous.length).toBe(104);
  for (const fixture of dangerous)
    expect(
      fixture.expected === "risky" ||
        (fixture.expected === "review" &&
          REVIEW_RULES.includes(fixture.ruleId!) &&
          fixture.executable === "git"),
      `${fixture.id} ${fixture.command}`,
    ).toBe(true);
});

it("never marks an ordinary fixture risky", () => {
  const ordinary = reachable.filter((f) => f.group === "ordinary");
  expect(ordinary.length).toBe(135);
  for (const fixture of ordinary)
    expect(fixture.expected, `${fixture.id} ${fixture.command}`).not.toBe(
      "risky",
    );
});
