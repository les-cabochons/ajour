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

const hunkIdSchema = z.string().min(1).max(1_100);

/**
 * A kind of change, on a concern and on the summary (#662). Rules find
 * `tests`, `docs`, `dependencies` and `build` from the paths; the agent's
 * guide run gives the others (#794).
 */
export const deckChangeKindSchema = z.enum([
  "breaking",
  "feature",
  "fix",
  "refactor",
  "performance",
  "tests",
  "docs",
  "dependencies",
  "build",
]);
export type DeckChangeKind = z.infer<typeof deckChangeKindSchema>;

/** The kinds in the order the page lists them. */
export const DECK_CHANGE_KINDS = deckChangeKindSchema.options;

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
  hunkIds: z.array(hunkIdSchema).min(1),
  /** Its kinds of change, in `DECK_CHANGE_KINDS` order. */
  kinds: z.array(deckChangeKindSchema).max(DECK_CHANGE_KINDS.length),
});
export type DeckConcern = z.infer<typeof deckConcernSchema>;

/** The tickets a pull request is linked to, as the summary shows them: never their text. */
export const deckTicketSchema = z.object({
  number: z.number().int().positive(),
  /** A GitHub issue's repository. Absent for a work item. */
  repository: z.string().min(1).max(240).optional(),
  title: z.string().min(1).max(1_000),
  url: z.string().url().max(2_000),
  /** The code host's name for its state, such as "Open" or "Active". */
  state: z.string().min(1).max(100),
});
export type DeckTicket = z.infer<typeof deckTicketSchema>;

/**
 * One line of the summary, with the hunks it is about. Its id is stable for
 * the pull request at one head, so a later ask can anchor to it (#793).
 */
export const deckSummaryLineSchema = z.object({
  id: z.string().min(1).max(200),
  text: z.string().min(1).max(500),
  /** In the diff's order. The page's link goes to the first. */
  hunkIds: z.array(hunkIdSchema).min(1),
  /** The concern a test coverage line is about. */
  concernId: z.string().min(1).max(100).optional(),
});
export type DeckSummaryLine = z.infer<typeof deckSummaryLineSchema>;

const summaryLinesSchema = z.array(deckSummaryLineSchema).max(500);

/**
 * What Deck shows in place of the description (#662). The rules fill it in
 * the guide build (#789); the agent's guide run fills `problem` when no
 * ticket is linked, the other kinds and `breaking` later (#794), in the
 * same fields as its `submit_guide`.
 */
export const deckSummarySchema = z.object({
  /** The problem the pull request fixes: the first linked ticket's title, from the rules. */
  problem: z
    .object({
      text: z.string().min(1).max(1_000),
      source: z.enum(["ticket", "inferred"]),
      ticket: deckTicketSchema.optional(),
    })
    .nullable(),
  /** Every linked ticket in the code host's order, or null when they couldn't be read. */
  tickets: z.array(deckTicketSchema).max(50).nullable(),
  /** The union of the concerns' kinds, in `DECK_CHANGE_KINDS` order. */
  kinds: z.array(deckChangeKindSchema).max(DECK_CHANGE_KINDS.length),
  breaking: summaryLinesSchema,
  /** Migrations, auth and security, deletion, locking and concurrency. */
  risks: summaryLinesSchema,
  /** The test files of each concern that has some. */
  tests: summaryLinesSchema,
  /** Changed code no test in the pull request covers, per concern. */
  untested: summaryLinesSchema,
  /** `TODO` and `FIXME` lines, debug output, commented-out code and skipped tests the pull request adds. */
  leftovers: summaryLinesSchema,
});
export type DeckSummary = z.infer<typeof deckSummarySchema>;

/**
 * A pull request's guide: its concerns in reading order, and the summary
 * built with them. `madeWith: "code"` is the guide Deck builds locally,
 * from the code, with the vendored pipeline and the summary's rules.
 */
export const deckGuideSchema = z.object({
  madeWith: z.literal("code"),
  concerns: z.array(deckConcernSchema).max(3_000),
  summary: deckSummarySchema,
});
export type DeckGuide = z.infer<typeof deckGuideSchema>;

/**
 * An opened pull request: its diff and its guide. The guide is null when
 * the pipeline failed, so the page shows the files A–Z.
 */
export const deckOpenedPullRequestSchema = deckPullRequestDiffSchema.extend({
  guide: deckGuideSchema.nullable(),
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

/** What an ask is about. Only a concern for now; selected lines come with #790. */
export const deckAskAnchorSchema = z.object({
  kind: z.literal("concern"),
  /** The concern's id in the guide. */
  id: z.string().min(1).max(100),
});
export type DeckAskAnchor = z.infer<typeof deckAskAnchorSchema>;

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
