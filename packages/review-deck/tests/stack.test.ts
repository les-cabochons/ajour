import assert from "node:assert/strict";
import { test } from "vitest";
import { invalidTrunkPattern, isTrunk, parseTrunkPatterns, stackFor, stackIndex, type StackPr } from "../stack.ts";

const TRUNKS = ["main", "dev", "uat", "*/00-*"];

test("trunk patterns: exact names, one-segment * and multi-segment **", () => {
  assert.ok(isTrunk("refs/heads/main", TRUNKS));
  assert.ok(isTrunk("UAT", TRUNKS));
  assert.ok(isTrunk("release/00-q4", TRUNKS));
  assert.ok(!isTrunk("a/b/00-x", TRUNKS));
  assert.ok(!isTrunk("feature/main-menu", TRUNKS));
  assert.ok(isTrunk("release/2026/q4", ["release/**"]));
  assert.deepEqual(parseTrunkPatterns(" main,\nrefs/heads/dev\n\n main , */00-*"), ["main", "dev", "*/00-*"]);
  assert.ok(invalidTrunkPattern("*/*"));
  assert.ok(invalidTrunkPattern("feat ure"));
  assert.equal(invalidTrunkPattern("*/00-*"), null);
});

const pr = (id: number, source: string, target: string, status: StackPr["status"] = "active"): StackPr => ({ id, repository: { id: "r" }, sourceBranch: source, targetBranch: target, status });

test("stacks follow source → target chains and stop at trunk branches", () => {
  const all = [pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "b"), pr(4, "solo", "main"), pr(5, "fix", "release/00-q4"), pr(6, "x", "gone")];
  const s = stackFor(all[1], all, TRUNKS)!;
  assert.deepEqual(s.layers.map((p) => p.id), [1, 2, 3]);
  assert.deepEqual(s.base, { branch: "main", trunk: true });
  assert.equal(s.parent?.id, 1);
  assert.deepEqual(s.children.map((p) => p.id), [3]);
  assert.equal(stackFor(all[3], all, TRUNKS), null, "a lone PR into a trunk isn't a stack");
  assert.equal(stackFor(all[4], all, TRUNKS), null, "*/00-* is a trunk");
  // Into a branch with no open PR (its parent merged or was abandoned): shown, with a non-trunk base.
  assert.deepEqual(stackFor(all[5], all, TRUNKS)!.base, { branch: "gone", trunk: false });
  const index = stackIndex(all, TRUNKS);
  assert.deepEqual(index.get(3), { index: 3, size: 3, bottomId: 1 });
  assert.equal(index.has(4), false);
});

test("stacks: forks, other repositories, closed PRs, and PRs from a trunk branch", () => {
  const all = [pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "a"), pr(4, "d", "a", "completed"), { ...pr(5, "e", "a"), repository: { id: "other" } }, pr(6, "main", "dev")];
  const s = stackFor(all[0], all, TRUNKS)!;
  assert.deepEqual(s.children.map((p) => p.id), [2, 3], "fork: both children, completed and other-repo PRs excluded");
  assert.deepEqual(s.layers.map((p) => p.id), [1, 2], "the path follows the first child");
  assert.deepEqual(stackFor(all[2], all, TRUNKS)!.layers.map((p) => p.id), [1, 3]);
  // main -> dev is a promotion between trunks: PR 1 (into main) must not stack on it.
  assert.equal(stackFor(all[5], all, TRUNKS), null);
});
