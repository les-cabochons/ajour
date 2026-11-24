import { z } from "zod";
import { codeHostPullRequestRefSchema } from "./code-host.ts";

/*
 * Deck's review page, as the local API serves it to the window. Deck builds a
 * pull request's diff from both versions of each changed file with Review
 * Deck's vendored `buildDiff`, never from the code host's patch, so its hunk
 * ids are Review Deck's: `path#index`. See docs/adr/0003 and
 * packages/review-deck/VENDORED.md.
 */

const pathSchema = z.string().min(1).max(1_000);
const lineNumberSchema = z.number().int().nonnegative();

export const deckHunkSchema = z.object({
  /** `path#index`, the hunk's place in its file, counted from 0. */
  id: z.string().min(1).max(1_100),
  /**
   * The `@@ -a,b +c,d @@` line. Empty for a file shown without hunks: a
   * binary file, or one renamed without changes.
   */
  header: z.string().max(10_000),
  oldStart: lineNumberSchema,
  oldLines: lineNumberSchema,
  newStart: lineNumberSchema,
  newLines: lineNumberSchema,
  /**
   * The hunk alone as a unified diff of its file, as Review Deck's
   * `hunkToPatch` writes it: the file's `diff --git` header, the `@@` line,
   * then each line after its `+`, `-` or space. Only the header for a file
   * shown without hunks.
   */
  patch: z.string(),
});
export type DeckHunk = z.infer<typeof deckHunkSchema>;

export const deckFileStatusSchema = z.enum([
  "added",
  "deleted",
  "modified",
  "renamed",
]);
export type DeckFileStatus = z.infer<typeof deckFileStatusSchema>;

export const deckFileSchema = z.object({
  /** The head's path, or the base's for a deleted file. */
  path: pathSchema,
  /** The base's path of a renamed file. */
  previousPath: pathSchema.optional(),
  status: deckFileStatusSchema,
  /**
   * Binary, too large to read, or named so the code host can't serve it:
   * shown without its lines.
   */
  binary: z.boolean(),
  /** At least one. */
  hunks: z.array(deckHunkSchema).min(1),
});
export type DeckFile = z.infer<typeof deckFileSchema>;

/** A pull request's diff from the merge base to the head, its files in path order. */
export const deckPullRequestDiffSchema = z.object({
  headSha: z.string().min(1).max(120),
  baseSha: z.string().min(1).max(120),
  files: z.array(deckFileSchema).max(3_000),
});
export type DeckPullRequestDiff = z.infer<typeof deckPullRequestDiffSchema>;

/** Opens a pull request of a code host connection in Deck. */
export const deckOpenRequestSchema = codeHostPullRequestRefSchema;
export type DeckOpenRequest = z.infer<typeof deckOpenRequestSchema>;

/**
 * One concern of a guide: hunks that belong together, with a title and a
 * one-line rationale, as Review Deck's pipeline groups them.
 */
export const deckConcernSchema = z.object({
  /** The pipeline's group id, such as `g1`, `misc` or `mechanical`. */
  id: z.string().min(1).max(100),
  title: z.string().max(500),
  rationale: z.string().max(2_000),
  /** Hunk ids of the diff, in reading order. */
  hunkIds: z.array(z.string().min(1).max(1_100)).min(1),
});
export type DeckConcern = z.infer<typeof deckConcernSchema>;

/**
 * A pull request's guide: its concerns in reading order. `madeWith: "code"`
 * is the guide Deck builds locally, from the code, with the vendored
 * pipeline.
 */
export const deckGuideSchema = z.object({
  madeWith: z.literal("code"),
  concerns: z.array(deckConcernSchema).max(3_000),
});
export type DeckGuide = z.infer<typeof deckGuideSchema>;

/**
 * The most hunks Deck builds a guide for (#790). Above it the pipeline
 * doesn't run: its syntax parsing and pair scoring would take over 10
 * seconds and hundreds of megabytes, growing with the square of the hunks
 * (36 s and 966 MB at 3,090), so the page shows the files A–Z.
 */
export const DECK_GUIDE_HUNK_LIMIT = 1_000;

/** Why an opened pull request has no guide although nothing failed. */
export const deckGuideSkippedSchema = z.object({
  /** It has more hunks than a guide is built for. */
  reason: z.literal("too_many_hunks"),
  /** The most hunks a guide is built for, `DECK_GUIDE_HUNK_LIMIT`. */
  hunkLimit: z.number().int().positive(),
});
export type DeckGuideSkipped = z.infer<typeof deckGuideSkippedSchema>;

/**
 * An opened pull request: its diff and its guide. The guide is null when
 * the pipeline failed, or didn't run because the pull request has more
 * hunks than a guide is built for, which `guideSkipped` says. Either way
 * the page shows the files A–Z.
 */
export const deckOpenedPullRequestSchema = deckPullRequestDiffSchema.extend({
  guide: deckGuideSchema.nullable(),
  guideSkipped: deckGuideSkippedSchema.optional(),
});
export type DeckOpenedPullRequest = z.infer<typeof deckOpenedPullRequestSchema>;

/** Builds the guides of pull requests ahead of their opening, at low priority. */
export const deckPreloadRequestSchema = z.object({
  pullRequests: z.array(deckOpenRequestSchema).max(20),
});
export type DeckPreloadRequest = z.infer<typeof deckPreloadRequestSchema>;
