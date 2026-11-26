import { describe, expect, it, vi } from "vitest";
import type {
  DeckAgentConsent,
  DeckAskRequest,
} from "../../../packages/shared/deck.ts";
import {
  createDeckAsks,
  DeckAskStopped,
  type DeckAsksOptions,
} from "./deck-asks.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";

/*
 * Stop on an ask (#795 review): a stop that comes before the turn starts
 * starts none, wherever the ask was waiting when it came.
 */

const SOURCE = { pluginId: "github", connectionId: "connection-1" };
const HEAD = "a41c9e2";

const held = {
  key: "entry-1",
  diff: { headSha: HEAD, baseSha: "base", files: [] },
  guide: {
    madeWith: "code",
    concerns: [
      {
        id: "g1",
        title: "Retries",
        rationale: "Why it retries.",
        hunkIds: ["src/retry.ts#0"],
        kinds: [],
      },
    ],
  },
  versions: {},
} as unknown as DeckHeldPullRequest;

const consent = {
  pluginId: SOURCE.pluginId,
  connectionId: SOURCE.connectionId,
  repository: "acme/api",
  cli: "claude-code",
} as unknown as DeckAgentConsent;

function asks(overrides: Partial<DeckAsksOptions>) {
  const startTurn = vi.fn(async () => ({ id: "turn-1" }) as never);
  const options: DeckAsksOptions = {
    storage: {
      getDeckConsents: async () => [consent],
      getAgentRunnerSettings: async () => ({ cli: "claude-code" }),
    },
    selectedCli: async () => null,
    deck: { held: async () => held },
    startTurn,
    ...overrides,
  };
  return { deckAsks: createDeckAsks(options), startTurn };
}

const request = (clone?: DeckAskRequest["clone"]): DeckAskRequest => ({
  repository: "acme/api",
  number: 7,
  head: HEAD,
  anchor: { kind: "concern", id: "g1" },
  ...(clone ? { clone } : {}),
});

describe("a stopped ask", () => {
  it("starts no turn when the stop comes while it reads the pull request", async () => {
    const controller = new AbortController();
    const { deckAsks, startTurn } = asks({
      deck: {
        held: async () => {
          controller.abort();
          return held;
        },
      },
    });
    await expect(
      deckAsks.ask(SOURCE, request(), controller.signal),
    ).rejects.toBeInstanceOf(DeckAskStopped);
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts no turn when the stop comes after the clone is prepared", async () => {
    const controller = new AbortController();
    let reads = 0;
    const { deckAsks, startTurn } = asks({
      deck: {
        held: async () => {
          // The second read checks the pull request is still held.
          if (++reads === 2) controller.abort();
          return held;
        },
      },
      clones: {
        isChosen: async () => true,
        prepare: async () =>
          ({ state: "read", root: "/deck/worktree" }) as never,
        release: async () => undefined,
      },
    });
    await expect(
      deckAsks.ask(
        SOURCE,
        request({
          repositoryIdentity: { host: "github.com", path: "acme/api" },
        } as unknown as DeckAskRequest["clone"]),
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(DeckAskStopped);
    expect(reads).toBe(2);
    expect(startTurn).not.toHaveBeenCalled();
  });
});
