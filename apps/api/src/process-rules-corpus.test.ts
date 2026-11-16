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
 *
 * Since round 1 of #740 the rule table is allowlist-first: only an
 * allowlisted read-only command gets no verdict, so most ordinary fixtures,
 * the shim injections and the parity edges are `risky` as `unknown`.
 * Round 3 added five `git log` format strings (case-268 to case-272) whose
 * modified signature atoms start gpg.
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
it("keeps #708's 267 fixtures and round 3's five, in every shell", () => {
  expect(fixtures).toHaveLength(272);
  const count = (reach: Fixture["reach"]) =>
    fixtures.filter((f) => f.reach === reach).length;
  expect([count("broker"), count("refused"), count("not-applicable")]).toEqual([
    251, 7, 14,
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

it("marks every dangerous fixture risky", () => {
  const dangerous = reachable.filter(
    (f) => f.group === "dangerous" || f.group === "prompt-injection",
  );
  expect(dangerous.length).toBe(109);
  for (const fixture of dangerous)
    expect(fixture.expected, `${fixture.id} ${fixture.command}`).toBe("risky");
});

it("lets an ordinary fixture run only from the allowlist, and asks for the rest as unknown", () => {
  const ordinary = reachable.filter((f) => f.group === "ordinary");
  expect(ordinary.length).toBe(135);
  // git's read-only subcommands, version probes of claude and codex, and
  // `pwd`. Since round 2 of #740, `ls`, `dir`, and npm's and pnpm's version
  // probes ask: they read the project or follow its symlinks. Since round 3,
  // node's asks too: a version manager's shim reads the project.
  expect(ordinary.filter((f) => f.expected === "none")).toHaveLength(37);
  for (const fixture of ordinary)
    expect(
      [fixture.expected, fixture.ruleId],
      `${fixture.id} ${fixture.command}`,
    ).toSatisfy(
      ([expected, ruleId]: [string, string | undefined]) =>
        (expected === "none" && ruleId === undefined) ||
        (expected === "risky" && ruleId === "unknown"),
    );
});

it("never returns review: the rule table only asks or lets an allowlisted command run", () => {
  expect(reachable.filter((f) => f.expected === "review")).toEqual([]);
});
