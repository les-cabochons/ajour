import { describe, expect, it } from "vitest";
import {
  agentTurnEventSchema,
  type AgentTurnEvent,
} from "../../../packages/shared/agent-runs.ts";
import {
  deckPullRequestKey,
  type DeckDraftCommentCall,
  type DeckPullRequestDiff,
} from "../../../packages/shared/deck.ts";
import {
  createDeckChatWrites,
  DeckChatRefused,
  type DeckChatWritesOptions,
  type DraftCommentClaimCheck,
  type RunningTurn,
} from "./deck-chat-writes.ts";
import type { DeckHeldPullRequest } from "./deck-service.ts";
import type { McpClientPullRequestBinding } from "./storage.ts";

/*
 * Deck's chat writes (#796, ADR 0024) with their seams faked: the turn,
 * the consent, the diff Deck holds, the code host and the window's draft
 * review. The local API's own tests (`deck-chat.test.ts`) run them for
 * real; these cover what a real run can't stop on cue.
 */

const HEAD = "a41c9e2f0d";
const PULL_REQUEST_URL = "https://github.com/acme/billing-api/pull/482";
const pullRequest = deckPullRequestKey({
  pluginId: "github",
  connectionId: "connection-1",
  repository: "acme/billing-api",
  number: 482,
});
const binding: McpClientPullRequestBinding = {
  pullRequest,
  head: HEAD,
  cli: "claude-code",
};
const LONG_PATH = `src/${"deeply/".repeat(72)}api.ts`;

/** A diff with one hunk that changes the second line of `path`. */
function diffOf(path: string): DeckPullRequestDiff {
  return {
    headSha: HEAD,
    baseSha: "b52d0f3a11",
    files: [
      {
        path,
        status: "modified",
        binary: false,
        hunks: [
          {
            id: `${path}#0`,
            header: "@@ -1,3 +1,3 @@",
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            patch: `diff --git a/${path} b/${path}\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three`,
          },
        ],
      },
    ],
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** The chat writes, with a chat turn running, the repository allowed and the diff held. */
function setup(path = "src/api.ts") {
  const turn: RunningTurn = {
    id: "turn-1",
    task: "deck.chat",
    pullRequest,
    head: HEAD,
    conversationId: "conversation-1",
  };
  const state = {
    running: turn as RunningTurn | undefined,
    allowed: true,
    held: undefined as Promise<void> | undefined,
    admission: undefined as Promise<void> | undefined,
    url: `${PULL_REQUEST_URL}#c1` as string | undefined,
  };
  const published: AgentTurnEvent[] = [];
  const hostCalls: string[] = [];
  const drafts: DeckDraftCommentCall[] = [];
  let answerDraft: (draftId: string) => void = () => {};
  /** The bridge's claim of the latest draft comment, as the window asks for it. */
  let claimDraft: () => ReturnType<DraftCommentClaimCheck> = () => undefined;
  const held = {
    key: "key",
    diff: diffOf(path),
    guide: null,
    builtGuide: null,
    versions: { old: new Map(), new: new Map() },
  } as unknown as DeckHeldPullRequest;
  const options: DeckChatWritesOptions = {
    runningTurnOf: () => state.running,
    allowed: async () => state.allowed,
    allowedNow: () => state.allowed,
    deck: {
      async held() {
        await state.held;
        return held;
      },
    },
    async codeHost(_source, operation, _request, beforeStart) {
      // The plugin's admission awaits before the plugin starts.
      await state.admission;
      beforeStart();
      hostCalls.push(operation);
      return { commentId: "c-1", url: state.url } as never;
    },
    addDraftComment(call, claimCheck) {
      drafts.push(call);
      claimDraft = claimCheck;
      return new Promise((resolve) => {
        answerDraft = (draftId) => resolve({ draftId });
      });
    },
    publish: (event) => published.push(agentTurnEventSchema.parse(event)),
    createId: (() => {
      let next = 0;
      return () => `id-${(next += 1)}`;
    })(),
  };
  const writes = createDeckChatWrites(options);
  writes.chatStarted(turn.id, {
    author: true,
    pullRequestUrl: PULL_REQUEST_URL,
  });
  return {
    writes,
    state,
    published,
    hostCalls,
    drafts,
    answerDraft: (draftId: string) => answerDraft(draftId),
    claimDraft: () => claimDraft(),
    actions: () =>
      published.flatMap((event) =>
        event.type === "action" ? [event.action] : [],
      ),
    end() {
      state.running = undefined;
      writes.observe({
        type: "ended",
        turnId: turn.id,
        conversationId: turn.conversationId,
        outcome: "cancelled",
      } as AgentTurnEvent);
    },
  };
}

const onLine = (path = "src/api.ts") => ({
  path,
  side: "head" as const,
  line: 2,
});

describe("a chat write's last check", () => {
  it("posts nothing once the turn stopped and the consent went while it read the diff", async () => {
    const chat = setup();
    const reading = deferred();
    chat.state.held = reading.promise;

    const posting = chat.writes.run("post_comment", "client-1", binding, {
      body: "Why upper case?",
      lines: onLine(),
    });
    await Promise.resolve();
    chat.state.running = undefined;
    chat.state.allowed = false;
    reading.resolve();

    await expect(posting).rejects.toBeInstanceOf(DeckChatRefused);
    expect(chat.hostCalls).toEqual([]);
    expect(chat.actions()).toEqual([]);
  });

  it("posts nothing when the consent goes during the plugin's admission", async () => {
    const chat = setup();
    const admitting = deferred();
    chat.state.admission = admitting.promise;
    const posting = chat.writes.run("post_comment", "client-1", binding, {
      body: "Looks good.",
    });
    await new Promise((resolve) => setImmediate(resolve));
    chat.state.allowed = false;
    admitting.resolve();

    await expect(posting).rejects.toThrow("no longer allows");
    expect(chat.hostCalls).toEqual([]);
  });

  it("refuses a write once another turn runs", async () => {
    const chat = setup();
    const reading = deferred();
    chat.state.held = reading.promise;
    const posting = chat.writes.run("post_comment", "client-1", binding, {
      body: "Here.",
      lines: onLine(),
    });
    await Promise.resolve();
    chat.state.running = { ...chat.state.running!, id: "turn-2" };
    reading.resolve();

    await expect(posting).rejects.toThrow("turn");
    expect(chat.hostCalls).toEqual([]);
  });

  it("sends the window no draft comment once the turn stopped while it read the diff", async () => {
    const chat = setup();
    const reading = deferred();
    chat.state.held = reading.promise;
    const adding = chat.writes.run("add_draft_comment", "client-1", binding, {
      ...onLine(),
      body: "Lower case?",
    });
    await Promise.resolve();
    chat.end();
    reading.resolve();

    await expect(adding).rejects.toBeInstanceOf(DeckChatRefused);
    expect(chat.drafts).toEqual([]);
  });

  it("names its turn to the window, and refuses the window's claim once the turn ended: the agent hears at once that nothing was added", async () => {
    const chat = setup();
    const adding = chat.writes.run("add_draft_comment", "client-1", binding, {
      ...onLine(),
      body: "Lower case?",
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(chat.drafts).toEqual([
      expect.objectContaining({ turnId: "turn-1", headSha: HEAD }),
    ]);

    chat.end();
    await expect(adding).rejects.toThrow("ended");
    // The window hears of the call only now, as after a disconnect.
    expect(chat.claimDraft()).toEqual({
      reason: "chat_turn_ended",
      message: expect.stringContaining("ended"),
    });
    expect(chat.actions()).toEqual([]);
  });

  it("refuses the window's claim once the repository is revoked", async () => {
    const chat = setup();
    void chat.writes
      .run("add_draft_comment", "client-1", binding, {
        ...onLine(),
        body: "Lower case?",
      })
      .catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    chat.state.allowed = false;

    expect(chat.claimDraft()).toMatchObject({ reason: "consent_revoked" });
  });

  it("finishes a draft comment the window claimed before Stop, with its line", async () => {
    const chat = setup();
    const adding = chat.writes.run("add_draft_comment", "client-1", binding, {
      ...onLine(),
      body: "Lower case?",
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(chat.claimDraft()).toBeUndefined();

    chat.end();
    chat.answerDraft("draft-1");

    await expect(adding).resolves.toMatchObject({
      action: "Added a draft comment on src/api.ts:2",
    });
    expect(chat.actions()).toEqual([
      expect.objectContaining({
        kind: "draft_comment",
        posted: { kind: "draft_comment", draftId: "draft-1" },
      }),
    ]);
  });
});

describe("an action line", () => {
  it("shortens a long path so the line fits, and keeps the whole path to show", async () => {
    expect(LONG_PATH.length).toBeGreaterThan(500);
    const chat = setup(LONG_PATH);

    const output = await chat.writes.run("post_comment", "client-1", binding, {
      body: "Here.",
      lines: onLine(LONG_PATH),
    });

    const [action] = chat.actions();
    expect(action!.text.length).toBeLessThanOrEqual(500);
    expect(action!.text).toMatch(
      /^Commented on src\/deeply\/.*….*\/api\.ts:2$/,
    );
    expect(action!.at).toEqual({ path: LONG_PATH, side: "head", line: 2 });
    expect(output.action).toBe(action!.text);
  });

  it("shortens a long title", async () => {
    const chat = setup();
    const title = "Shout ".repeat(160).trim();
    const writes = createDeckChatWrites({
      runningTurnOf: () => chat.state.running,
      allowed: async () => true,
      allowedNow: () => true,
      deck: { held: async () => undefined },
      codeHost: async (_source, _operation, _request, beforeStart) => {
        beforeStart();
        return { title, draft: false } as never;
      },
      addDraftComment: async () => ({ draftId: "d" }),
      publish: (event) =>
        chat.published.push(agentTurnEventSchema.parse(event)),
    });
    writes.chatStarted("turn-1", { author: true });

    await writes.run("edit_title", "client-1", binding, { title });

    const [action] = chat.actions();
    expect(action!.text.length).toBeLessThanOrEqual(500);
    expect(action!.text.endsWith("…”")).toBe(true);
    expect(action!.edited).toEqual({ title, draft: false });
  });

  it("never cuts a character in half", async () => {
    const chat = setup();
    const title = "🔥".repeat(300);
    const writes = createDeckChatWrites({
      runningTurnOf: () => chat.state.running,
      allowed: async () => true,
      allowedNow: () => true,
      deck: { held: async () => undefined },
      codeHost: async (_source, _operation, _request, beforeStart) => {
        beforeStart();
        return { title, draft: false } as never;
      },
      addDraftComment: async () => ({ draftId: "d" }),
      publish: (event) =>
        chat.published.push(agentTurnEventSchema.parse(event)),
    });
    writes.chatStarted("turn-1", { author: true });

    await writes.run("edit_title", "client-1", binding, { title });

    const [action] = chat.actions();
    // No lone half of a surrogate pair is left.
    expect(action!.text).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u);
    expect(
      Array.from(action!.text.replace(/^Renamed the pull request “|…”$/g, "")),
    ).toEqual(Array(199).fill("🔥"));
  });

  it.each([
    ["javascript:alert(1)"],
    ["https://github.com.evil.example/pr/1"],
    ["http://github.com/acme/billing-api/pull/482#c1"],
    ["data:text/html,hi"],
  ])("leaves out a link off the pull request's code host: %s", async (url) => {
    const chat = setup();
    chat.state.url = url;

    const output = await chat.writes.run("post_comment", "client-1", binding, {
      body: "Looks good.",
    });

    expect(chat.actions()[0]!.url).toBeUndefined();
    expect(output.url).toBeUndefined();
  });

  it("keeps a link on the pull request's code host", async () => {
    const chat = setup();

    const output = await chat.writes.run("post_comment", "client-1", binding, {
      body: "Looks good.",
    });

    expect(chat.actions()[0]!.url).toBe(`${PULL_REQUEST_URL}#c1`);
    expect(output.url).toBe(`${PULL_REQUEST_URL}#c1`);
  });
});
