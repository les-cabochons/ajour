import { z } from "zod";
import { agentCliIdSchema, agentTurnSchema } from "./agent-runs.ts";
import {
  codeHostPullRequestRefSchema,
  codeHostRepositoryIdentitySchema,
} from "./code-host.ts";

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

/** What an ask is about. Only a concern for now; selected lines come with #790. */
export const deckAskAnchorSchema = z.object({
  kind: z.literal("concern"),
  /** The concern's id in the guide. */
  id: z.string().min(1).max(100),
});
export type DeckAskAnchor = z.infer<typeof deckAskAnchorSchema>;

/**
 * What Deck needs to read the user's clone at the pull request's head,
 * from the pull request's facts: its clone addresses and its branch.
 */
export const deckCloneSourceSchema = z.object({
  repositoryIdentity: codeHostRepositoryIdentitySchema,
  headRef: z.string().trim().min(1).max(400).optional(),
});
export type DeckCloneSource = z.infer<typeof deckCloneSourceSchema>;

/**
 * Whether an answer read the user's clone (#795): it did, it couldn't and
 * why, or the user hasn't chosen one for the repository. Absent when the
 * code host doesn't say where the repository is cloned from.
 */
export const deckCloneUseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("read") }),
  z.object({ state: z.literal("unavailable"), reason: z.string() }),
  z.object({ state: z.literal("not_chosen") }),
]);
export type DeckCloneUse = z.infer<typeof deckCloneUseSchema>;

/** Asks about a pull request at one head, on its default question or a typed one. */
export const deckAskRequestSchema = z.object({
  repository: codeHostPullRequestRefSchema.shape.repository,
  number: codeHostPullRequestRefSchema.shape.number,
  /** The head the page shows. */
  head: z.string().regex(/^[0-9a-f]{7,64}$/i, "A head is a commit ID."),
  anchor: deckAskAnchorSchema,
  /** The user's own question, in place of the anchor's default one. */
  question: z.string().trim().min(1).max(DECK_QUESTION_MAX).optional(),
  /** Where the repository is cloned from, so the agent can read the user's clone too. */
  clone: deckCloneSourceSchema.optional(),
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
    clone: deckCloneUseSchema.optional(),
  }),
  z.object({
    kind: z.literal("turn"),
    turn: agentTurnSchema,
    clone: deckCloneUseSchema.optional(),
  }),
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
 * The user's local clones (#795): one per repository, on this computer or
 * in a WSL distribution. Kept in the local API's machine-local state, never
 * synced and never in the content cache.
 */

/** Where a clone lives: this computer's own file system, or a WSL distribution's. */
export const deckCloneEnvironmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({
    kind: z.literal("wsl"),
    distro: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  }),
]);
export type DeckCloneEnvironment = z.infer<typeof deckCloneEnvironmentSchema>;

/** The clone the user chose for a repository. */
export const deckCloneSchema = z.object({
  pluginId: z.string().min(1),
  connectionId: z.string().min(1),
  repository: codeHostPullRequestRefSchema.shape.repository,
  environment: deckCloneEnvironmentSchema,
  /** The clone's top folder: a native path, or a Linux path in its distribution. */
  path: z.string().min(1).max(4_000),
  /** The remote Deck fetches from, whose address matched the repository. */
  remote: z.string().min(1).max(200),
  chosenAt: z.number().int().nonnegative(),
});
export type DeckClone = z.infer<typeof deckCloneSchema>;

export const deckClonesSchema = z.object({ clones: z.array(deckCloneSchema) });
export type DeckClones = z.infer<typeof deckClonesSchema>;

/** A repository folder Ajour already knows whose remote names the repository. */
export const deckCloneSuggestionSchema = z.object({
  /** The repository folder's ID, which choosing it sends back. */
  folderId: z.string().min(1),
  name: z.string(),
  path: z.string(),
});
export type DeckCloneSuggestion = z.infer<typeof deckCloneSuggestionSchema>;

/** Asks for the repository's clone, and the folders that could be it. */
export const deckCloneSuggestionsRequestSchema = z.object({
  repository: codeHostPullRequestRefSchema.shape.repository,
  clone: deckCloneSourceSchema,
});

export const deckCloneSuggestionsSchema = z.object({
  clone: deckCloneSchema.optional(),
  suggestions: z.array(deckCloneSuggestionSchema),
});
export type DeckCloneSuggestions = z.infer<typeof deckCloneSuggestionsSchema>;

/** Chooses a suggested folder as the repository's clone. */
export const deckCloneChooseRequestSchema = z.object({
  repository: codeHostPullRequestRefSchema.shape.repository,
  clone: deckCloneSourceSchema,
  folderId: z.string().min(1).max(200),
});

/** Forgets a repository's clone. */
export const deckCloneForgetRequestSchema = deckConsentRevokeRequestSchema;

/** Why a folder can't be the repository's clone, as the picker shows it. */
export const deckCloneRefusalSchema = z.object({
  reason: z.literal("clone_refused"),
  error: z.string(),
});

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
