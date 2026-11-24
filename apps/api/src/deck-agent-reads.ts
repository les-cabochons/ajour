import type { CodeHostConversationResult } from "../../../packages/shared/code-host.ts";
import {
  parseDeckPullRequestKey,
  type DeckPullRequestSource,
  type DeckToolInput,
  type DeckToolName,
  type DeckToolOutput,
} from "../../../packages/shared/deck.ts";
import type { McpClientPullRequestBinding } from "./storage.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";

/*
 * Deck's reads for the agent (#791): `read_hunks`, `read_file`,
 * `read_threads` and `read_guide`, the tools of a conversation's client.
 * Each answers for the client's binding only, the pull request and head the
 * conversation is about, from what Deck holds for it: never another pull
 * request, another head, or the user's own data (ADR 0021). Each needs the
 * repository's consent for the binding's agent, never the one picked now.
 */

/** A read the binding can't answer, with a sentence for the agent. */
export class DeckReadRefused extends Error {}

export interface DeckAgentReadsOptions {
  deck: {
    held(
      pullRequest: string,
      head: string,
    ): Promise<DeckHeldPullRequest | undefined>;
  };
  /**
   * Whether the user still allows the binding's repository with the
   * binding's agent, the one its conversation runs.
   */
  allowed(binding: McpClientPullRequestBinding): Promise<boolean>;
  /** The pull request's threads, read through its code host plugin. */
  conversation(
    source: DeckPullRequestSource,
  ): Promise<CodeHostConversationResult>;
}

export function createDeckAgentReads(options: DeckAgentReadsOptions) {
  async function heldFor(binding: McpClientPullRequestBinding) {
    if (!(await options.allowed(binding))) {
      throw new DeckReadRefused(
        "The user no longer allows Ajour to send this repository's code to you. Stop, and say only that you can't read it now.",
      );
    }
    const held = await options.deck.held(binding.pullRequest, binding.head);
    if (!held) {
      throw new DeckReadRefused(
        "Ajour no longer holds this pull request at this head, because the user moved to another one. Answer from what you already read.",
      );
    }
    return held;
  }

  const reads: {
    [Name in DeckToolName]: (
      binding: McpClientPullRequestBinding,
      input: DeckToolInput<Name>,
    ) => Promise<DeckToolOutput<Name>>;
  } = {
    async read_hunks(binding, { ids }) {
      const { diff } = await heldFor(binding);
      const byId = new Map(
        diff.files.flatMap((file) =>
          file.hunks.map((hunk) => [hunk.id, { file, hunk }] as const),
        ),
      );
      const hunks: DeckToolOutput<"read_hunks">["hunks"] = [];
      const unknownIds: string[] = [];
      for (const id of new Set(ids)) {
        const found = byId.get(id);
        if (found) {
          hunks.push({ id, path: found.file.path, patch: found.hunk.patch });
        } else {
          unknownIds.push(id);
        }
      }
      return { hunks, unknownIds };
    },

    async read_file(binding, { path, side }) {
      const { diff, versions } = await heldFor(binding);
      const file = diff.files.find((candidate) =>
        side === "base"
          ? (candidate.previousPath ?? candidate.path) === path
          : candidate.path === path,
      );
      if (!file) {
        throw new DeckReadRefused(
          `This pull request doesn't change ${path}. Only its changed files can be read.`,
        );
      }
      const content = (side === "base" ? versions.old : versions.new).get(path);
      if (content === undefined && !file.binary) {
        throw new DeckReadRefused(
          `${path} has no ${side} version: the pull request ${side === "base" ? "adds" : "deletes"} it.`,
        );
      }
      return { path, side, content: content ?? null };
    },

    async read_threads(binding) {
      await heldFor(binding);
      const source = parseDeckPullRequestKey(binding.pullRequest);
      if (!source)
        throw new DeckReadRefused("Deck doesn't know this pull request.");
      const { threads } = await options.conversation(source);
      return {
        threads: threads.map((thread) => ({
          path: thread.path,
          side: thread.side,
          ...(thread.line === undefined ? {} : { line: thread.line }),
          resolved: thread.resolved,
          outdated: thread.outdated,
          comments: thread.comments.map((comment) => ({
            author: comment.author.displayName ?? comment.author.login,
            body: comment.body,
          })),
        })),
      };
    },

    async read_guide(binding) {
      const { guide } = await heldFor(binding);
      return {
        concerns: (guide?.concerns ?? []).map((concern) => ({
          id: concern.id,
          title: concern.title,
          rationale: concern.rationale,
          hunkIds: concern.hunkIds,
        })),
      };
    },
  };

  return {
    run<Name extends DeckToolName>(
      name: Name,
      binding: McpClientPullRequestBinding,
      input: DeckToolInput<Name>,
    ): Promise<DeckToolOutput<Name>> {
      return (
        reads[name] as (
          binding: McpClientPullRequestBinding,
          input: DeckToolInput<Name>,
        ) => Promise<DeckToolOutput<Name>>
      )(binding, input);
    },
  };
}

export type DeckAgentReads = ReturnType<typeof createDeckAgentReads>;
