import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildDiff,
  createPipelineDeps,
  type FileContents,
  mergeConfig,
  type ReviewResult,
  runPipeline,
} from "../pipeline.ts";

// Upstream tested the description's steps through score/description.ts and title/fromDescription.ts directly.
// Here the same cases go through runPipeline: the steps show as the description signal's evidence on hunk
// pairs, and as the titles of the groups they match.

const guided = [
  "**Problem.** Bitbucket pull requests came back without a head commit.",
  "",
  "**Fix, in reading order:**",
  "1. **Decode the source commit** (`packages/bitbucket/src/server/pullRequestJson.ts`). Adds `headSha`.",
  "   - Nested detail stays in step 1.",
  "2. **Pass it on** (`packages/source-control-{core,bitbucket}/src/client/definition.ts`). `toChangeRequest` adds it.",
  "3. **Docs** under `docs/user/`.",
].join("\n");

/** One changed line per file, with nothing the files share but what the description says. */
const files: Record<string, [string, string]> = {
  "packages/bitbucket/src/server/pullRequestJson.ts": [
    "export const sourceShape = 1;\n",
    "export const sourceShape = 2;\n",
  ],
  "packages/bitbucket/src/server/pullRequestJson.test.ts": [
    "it('decodes', () => one());\n",
    "it('decodes', () => two());\n",
  ],
  "packages/source-control-core/src/client/definition.ts": [
    "export const coreLimit = 1;\n",
    "export const coreLimit = 2;\n",
  ],
  "packages/source-control-bitbucket/src/client/definition.ts": [
    "export const bitbucketLimit = 1;\n",
    "export const bitbucketLimit = 2;\n",
  ],
  "packages/bitbucket/src/server/Provider.ts": [
    "export function toChangeRequest(pr: number) {\n  return pr;\n}\n",
    "export function toChangeRequest(pr: number) {\n  return pr + 1;\n}\n",
  ],
  "docs/user/prompt-links.md": [
    "# Prompt links\n",
    "# Prompt links, with heads\n",
  ],
  "docs/user/sources.md": ["# Sources\n", "# Sources, with commits\n"],
  "apps/web/src/unrelated.ts": [
    "export const elsewhere = 1;\n",
    "export const elsewhere = 2;\n",
  ],
};

const id = (path: string) => `${path}#0`;
const json = id("packages/bitbucket/src/server/pullRequestJson.ts");
const jsonTest = id("packages/bitbucket/src/server/pullRequestJson.test.ts");
const core = id("packages/source-control-core/src/client/definition.ts");
const bitbucket = id(
  "packages/source-control-bitbucket/src/client/definition.ts",
);
const provider = id("packages/bitbucket/src/server/Provider.ts");
const docs = id("docs/user/prompt-links.md");
const moreDocs = id("docs/user/sources.md");
const other = id("apps/web/src/unrelated.ts");

const deps = await createPipelineDeps();

async function review(description: string): Promise<ReviewResult> {
  const contents = new Map<string, FileContents>(
    Object.entries(files).map(([path, [old, next]]) => [
      path,
      { old, new: next, binary: false, tooLarge: false },
    ]),
  );
  const diff = buildDiff(
    Object.keys(files).map((path) => ({ path, changeType: "edit" as const })),
    contents,
  );
  const provide = {
    get: async (path: string, side: "old" | "new") =>
      contents.get(path)?.[side] ?? null,
  };
  return runPipeline(
    { title: "Pass the head commit on", description, diff, files: provide },
    mergeConfig(),
    deps,
  );
}

/** The description signal between two hunks: its score and the step it names, or null. */
function step(
  result: ReviewResult,
  a: string,
  b: string,
): { score: number; evidence: string } | null {
  const pair = result.pairs.find(
    (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a),
  );
  const signal = pair?.signals.description;
  return signal
    ? { score: signal.score, evidence: signal.evidence.join("; ") }
    : null;
}

test("Given hunks named by a step's files, folders or symbols, then the description links them as that step", async () => {
  const result = await review(guided);
  // Top-level items are steps 1 to 5, lead-ins included, and a test of a named file goes with it.
  assert.equal(
    step(result, json, jsonTest)?.evidence,
    "description step 3: Decode the source commit",
  );
  // `{core,bitbucket}` names both files, and a symbol names the file that defines it.
  assert.equal(
    step(result, core, bitbucket)?.evidence,
    "description step 4: Pass it on",
  );
  assert.equal(
    step(result, core, provider)?.evidence,
    "description step 4: Pass it on",
  );
  // A folder names the files under it.
  assert.equal(
    step(result, docs, moreDocs)?.evidence,
    "description step 5: Docs",
  );
  for (const h of [json, core, docs])
    assert.equal(step(result, other, h), null);
  assert.equal(step(result, json, core), null);
  assert.ok(
    step(result, core, bitbucket)!.score > step(result, core, provider)!.score,
    "a named file is stronger evidence than a named symbol",
  );
});

test("Given a description without steps, then it doesn't guide grouping", async () => {
  const result = await review(
    "Test PR for Semantic PR Review: upstream commit `5fe7568e87`, cherry-picked onto `main`.",
  );
  assert.equal(
    result.pairs.some((p) => p.signals.description),
    false,
  );
});

test("Given a group that mostly matches one step, then it takes the step's heading and first sentences", async () => {
  const result = await review(guided);
  const groupOf = (hunk: string) =>
    result.groups.find((g) => g.hunkIds.includes(hunk))!;
  assert.deepEqual(
    {
      title: groupOf(json).title,
      rationale: groupOf(json).rationale,
      source: groupOf(json).titleSource,
    },
    {
      title: "Decode the source commit",
      rationale: "Adds headSha. Nested detail stays in step 1.",
      source: "description",
    },
  );
  assert.deepEqual(
    {
      title: groupOf(core).title,
      rationale: groupOf(core).rationale,
      source: groupOf(core).titleSource,
    },
    {
      title: "Pass it on",
      rationale: "toChangeRequest adds it.",
      source: "description",
    },
  );
  // No step names it, and lead-ins ("**Problem.** ...") never title a group.
  assert.notEqual(groupOf(other).titleSource, "description");
});
