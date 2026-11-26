import { z } from "zod";
import { agentCliIdSchema, agentTurnSchema } from "./agent-runs.ts";
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

/**
 * Opens a pull request of a code host connection in Deck. `headSha` is the
 * head the window's last sync saw: when the content cache holds the pull
 * request at that head, it opens from there without asking the code host.
 */
export const deckOpenRequestSchema = codeHostPullRequestRefSchema.extend({
  headSha: z.string().trim().min(1).max(120).optional(),
});
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

/** Why an opened pull request has no guide although nothing failed. */
export const deckGuideSkippedSchema = z.object({
  /** It has more hunks than a guide is built for. */
  reason: z.literal("too_many_hunks"),
  /** The most hunks a guide is built for (#790). */
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

/**
 * Reads pull requests into the content cache ahead of their opening, and
 * builds their guides at low priority. One cached at the `headSha` given
 * isn't asked of the code host again.
 */
export const deckPreloadRequestSchema = z.object({
  pullRequests: z.array(deckOpenRequestSchema).max(20),
});
export type DeckPreloadRequest = z.infer<typeof deckPreloadRequestSchema>;

/** A preload's answer: the guide builds it queued. */
export const deckPreloadResultSchema = z.object({
  queued: z.number().int().nonnegative(),
});

/*
 * Changes since your review (#787): the hunks on screen that changed since
 * the version the user last reviewed, each with the version it last
 * changed in. A hunk whose added and removed lines are the same bytes in
 * the reviewed version is unchanged, wherever a rebase moved it.
 */

const deckCommitSchema = z.string().trim().min(1).max(120);

/** Compares the diff at `head`, the one on screen, with the version reviewed. */
export const deckSinceReviewRequestSchema = codeHostPullRequestRefSchema.extend(
  {
    head: deckCommitSchema,
    /** The head of the version the user last reviewed. */
    reviewedHead: deckCommitSchema,
  },
);
export type DeckSinceReviewRequest = z.infer<
  typeof deckSinceReviewRequestSchema
>;

export const deckSinceReviewSchema = z.object({
  head: deckCommitSchema,
  reviewedHead: deckCommitSchema,
  /** The numbers of both versions, as the code host numbers them. */
  version: z.number().int().positive(),
  reviewedVersion: z.number().int().positive(),
  /**
   * The hunks of the diff at `head` changed since the version reviewed, in
   * the diff's order, each with the version it last changed in. Every other
   * hunk is unchanged.
   */
  changed: z.array(
    z.object({
      hunkId: z.string().min(1).max(1_100),
      version: z.number().int().positive(),
    }),
  ),
});
export type DeckSinceReview = z.infer<typeof deckSinceReviewSchema>;

/** The content cache's cap until the user sets one in Settings › Storage: 1 GB. */
export const DECK_CACHE_DEFAULT_CAP_BYTES = 1024 ** 3;

/** Sets the content cache's cap, in bytes. Settings › Storage offers a few. */
export const deckCacheSettingsUpdateSchema = z
  .object({
    capBytes: z
      .number()
      .int()
      .positive()
      .max(1024 ** 4),
  })
  .strict();
export type DeckCacheSettingsUpdate = z.infer<
  typeof deckCacheSettingsUpdateSchema
>;

/** Settings › Storage: what the content cache holds, and its cap. */
export const deckCacheStorageSchema = z.object({
  /** What is on disk, the files not deleted yet included. */
  sizeBytes: z.number().int().nonnegative(),
  capBytes: z.number().int().positive(),
  entryCount: z.number().int().nonnegative(),
  /**
   * The entries removed whose files another program held, as an antivirus
   * scan does on Windows: they count until a later pass deletes them.
   */
  pendingRemovalCount: z.number().int().nonnegative(),
});
export type DeckCacheStorage = z.infer<typeof deckCacheStorageSchema>;

/*
 * Asks (#791): a question to the agent anchored to what the user reads, its
 * answer streamed in place. The first ask is "more detail" on a concern. An
 * ask is a `deck.ask` turn of the pull request's conversation; the answer is
 * cached per anchor, typed question and head commit.
 */

/** The longest question a user types. */
export const DECK_QUESTION_MAX = 2_000;

/**
 * The question an ask about a concern opens on. Sent as is, the ask carries
 * no question, so its answer is cached as the default one.
 */
export const DECK_CONCERN_DEFAULT_QUESTION =
  "Give more detail on this concern: what it changes, why, and what a reviewer should check.";

/**
 * Where a pull request is, as a conversation's key: its plugin, connection,
 * repository and number. The agent runner keys the conversation, and binds
 * its tools, by this string.
 */
export interface DeckPullRequestSource {
  pluginId: string;
  connectionId: string;
  repository: string;
  number: number;
}

const deckPullRequestKeySchema = z.tuple([
  z.literal("deck"),
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
  z.number().int().positive(),
]);

/** The conversation key of a pull request. */
export function deckPullRequestKey(source: DeckPullRequestSource): string {
  return JSON.stringify([
    "deck",
    source.pluginId,
    source.connectionId,
    source.repository,
    source.number,
  ]);
}

/** The pull request a conversation key names, or undefined for any other string. */
export function parseDeckPullRequestKey(
  key: string,
): DeckPullRequestSource | undefined {
  let value: unknown;
  try {
    value = JSON.parse(key);
  } catch {
    return undefined;
  }
  const parsed = deckPullRequestKeySchema.safeParse(value);
  if (!parsed.success) return undefined;
  const [, pluginId, connectionId, repository, number] = parsed.data;
  return { pluginId, connectionId, repository, number };
}

/** A repository's own name, without its owner: `billing-api` for `acme/billing-api`. */
export function repositoryName(repository: string): string {
  return repository.slice(repository.lastIndexOf("/") + 1) || repository;
}

/** How the agent and its refusals name a pull request: `acme/api#482`, or the key itself. */
export function deckPullRequestLabel(key: string): string {
  const source = parseDeckPullRequestKey(key);
  return source ? `${source.repository}#${source.number}` : key;
}

/**
 * The question an ask about selected lines opens on (#793): Explain sends
 * it as is, so its answer is cached as the default one.
 */
export const DECK_LINES_DEFAULT_QUESTION =
  "Explain these lines: what they do, why they changed, and what a reviewer should check.";

/** A line of a hunk: a removed line by the base's number, any other by the head's. */
export const deckLinePointSchema = z.object({
  side: z.enum(["base", "head"]),
  line: z.number().int().positive(),
});
export type DeckLinePoint = z.infer<typeof deckLinePointSchema>;

/**
 * What an ask is about: a concern of the guide, or lines selected in one
 * hunk, from `start` to `end` in the hunk's row order. The lines can run
 * over both sides, as a change's removed and added lines do.
 */
export const deckAskAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("concern"),
    /** The concern's id in the guide. */
    id: z.string().min(1).max(100),
  }),
  z.object({
    kind: z.literal("lines"),
    /** The file's path, as the diff names it. */
    path: pathSchema,
    start: deckLinePointSchema,
    end: deckLinePointSchema,
  }),
]);
export type DeckAskAnchor = z.infer<typeof deckAskAnchorSchema>;
export type DeckLinesAnchor = Extract<DeckAskAnchor, { kind: "lines" }>;

const pointName = (point: DeckLinePoint) =>
  point.side === "base" ? `removed line ${point.line}` : `line ${point.line}`;

/** How the page and the agent name selected lines: "line 12", "lines 12–14", "removed line 3 to line 5". */
export function deckLinesLabel({ start, end }: DeckLinesAnchor): string {
  if (start.side === end.side && start.line === end.line)
    return pointName(start);
  if (start.side === end.side)
    return `${start.side === "base" ? "removed lines" : "lines"} ${start.line}–${end.line}`;
  return `${pointName(start)} to ${pointName(end)}`;
}

/** Asks about a pull request at one head, on its default question or a typed one. */
export const deckAskRequestSchema = z.object({
  repository: codeHostPullRequestRefSchema.shape.repository,
  number: codeHostPullRequestRefSchema.shape.number,
  /** The head the page shows. */
  head: z.string().regex(/^[0-9a-f]{7,64}$/i, "A head is a commit ID."),
  anchor: deckAskAnchorSchema,
  /** The user's own question, in place of the anchor's default one. */
  question: z.string().trim().min(1).max(DECK_QUESTION_MAX).optional(),
});
export type DeckAskRequest = z.infer<typeof deckAskRequestSchema>;

/**
 * An ask's answer: the cached one at once, or the turn that writes it, whose
 * `agent-turn` events stream the text.
 */
export const deckAskResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    text: z.string(),
    /** The head the answer is about. */
    head: z.string(),
  }),
  z.object({ kind: z.literal("turn"), turn: agentTurnSchema }),
]);
export type DeckAskResponse = z.infer<typeof deckAskResponseSchema>;

/** The agent an ask would send the pull request to, as the consent dialog names it. */
export const deckAgentProviderSchema = z.object({
  cli: agentCliIdSchema,
  label: z.string(),
  version: z.string().optional(),
});
export type DeckAgentProvider = z.infer<typeof deckAgentProviderSchema>;

/**
 * The refusal of an ask in a repository the user hasn't allowed yet, with
 * the agent it would use: the page asks once, then asks again.
 */
export const deckNeedsConsentSchema = z.object({
  reason: z.literal("needs_consent"),
  repository: z.string(),
  provider: deckAgentProviderSchema,
});
export type DeckNeedsConsent = z.infer<typeof deckNeedsConsentSchema>;

/** Why Deck refused an ask, as the page reads it. */
export type DeckAskRefusal =
  | (DeckNeedsConsent & { error: string })
  | { error: string; reason: "not_open" | "unknown_anchor" };

/** The user allowed asks about a repository's pull requests, with one agent. */
export const deckAgentConsentSchema = z.object({
  pluginId: z.string().min(1),
  connectionId: z.string().min(1),
  repository: codeHostPullRequestRefSchema.shape.repository,
  /** The agent allowed. Another one asks again. */
  cli: agentCliIdSchema,
  cliVersion: z.string().max(120).optional(),
  consentedAt: z.number().int().nonnegative(),
});
export type DeckAgentConsent = z.infer<typeof deckAgentConsentSchema>;

/**
 * Allows asks about a repository's pull requests with the agent the consent
 * dialog named. It is refused when Settings › Agents picks another one now.
 */
export const deckConsentRequestSchema = z.object({
  repository: codeHostPullRequestRefSchema.shape.repository,
  cli: agentCliIdSchema,
});

/** Takes a repository's consent back. */
export const deckConsentRevokeRequestSchema = z.object({
  pluginId: z.string().min(1),
  connectionId: z.string().min(1),
  repository: codeHostPullRequestRefSchema.shape.repository,
});
export type DeckConsentRevokeRequest = z.infer<
  typeof deckConsentRevokeRequestSchema
>;

export const deckConsentsSchema = z.object({
  consents: z.array(deckAgentConsentSchema),
});
export type DeckConsents = z.infer<typeof deckConsentsSchema>;

/*
 * The agent's reads (#791): Deck's MCP tools, for a conversation's client
 * only, each bound to the client's pull request and head.
 */

export const DECK_HUNKS_PER_READ = 50;

export const deckToolInputSchemas = {
  read_hunks: z.object({
    ids: z.array(z.string().min(1).max(1_100)).min(1).max(DECK_HUNKS_PER_READ),
  }),
  read_file: z.object({
    path: pathSchema,
    side: z.enum(["base", "head"]),
  }),
  read_threads: z.object({}),
  read_guide: z.object({}),
} as const;
export type DeckToolName = keyof typeof deckToolInputSchemas;
export type DeckToolInput<Name extends DeckToolName> = z.infer<
  (typeof deckToolInputSchemas)[Name]
>;

export const deckToolOutputSchemas = {
  read_hunks: z.object({
    hunks: z.array(
      z.object({ id: z.string(), path: z.string(), patch: z.string() }),
    ),
    /** Ids the diff doesn't have. */
    unknownIds: z.array(z.string()),
  }),
  read_file: z.object({
    path: z.string(),
    side: z.enum(["base", "head"]),
    /** Null for a binary file. */
    content: z.string().nullable(),
  }),
  read_threads: z.object({
    threads: z.array(
      z.object({
        path: z.string(),
        side: z.enum(["base", "head"]),
        line: z.number().optional(),
        resolved: z.boolean(),
        outdated: z.boolean(),
        comments: z.array(z.object({ author: z.string(), body: z.string() })),
      }),
    ),
  }),
  read_guide: z.object({
    concerns: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        rationale: z.string(),
        hunkIds: z.array(z.string()),
      }),
    ),
  }),
} as const;
export type DeckToolOutput<Name extends DeckToolName> = z.infer<
  (typeof deckToolOutputSchemas)[Name]
>;
