import { describe, expect, it } from "vitest";
import type { AgentTurnAction } from "@ajour/shared/agent-runs";
import {
  applyChatEvent,
  carryAnchor,
  chatGoing,
  chatHeader,
  emptyChat,
  failReply,
  markDeletion,
  removeChip,
  replyStarted,
  sendMessage,
  type ChatState,
} from "./chat";

const TURN = "turn-1";
const CONVERSATION = "conversation-1";

const comment: AgentTurnAction = {
  id: "action-1",
  kind: "comment",
  text: "Commented on src/api.ts:12",
  url: "https://github.com/acme/api/pull/7#discussion_r1",
  posted: { kind: "comment", commentId: "c-1" },
};

/** A chat with one message sent and its turn started. */
function sent(text = "Is the retry safe?"): ChatState {
  const sending = sendMessage({ ...emptyChat(), draft: text }, "m1");
  if (!sending) throw new Error("Nothing was sent.");
  return replyStarted(sending.state, TURN);
}

describe("Deck's chat", () => {
  it("sends the composer's words as a message, with a reply on its way", () => {
    const sending = sendMessage(
      { ...emptyChat(), draft: "  Is the retry safe?  " },
      "m1",
    );

    expect(sending?.message).toEqual({ text: "Is the retry safe?" });
    expect(sending?.state.draft).toBe("");
    expect(sending?.state.entries).toEqual([
      { kind: "message", id: "m1", text: "Is the retry safe?" },
      { kind: "reply", id: "m1:reply", state: { kind: "asking" } },
    ]);
    expect(chatGoing(sending!.state)).toBe(true);
  });

  it("sends nothing blank, and nothing while a reply is still coming", () => {
    expect(sendMessage({ ...emptyChat(), draft: "   " }, "m1")).toBeUndefined();
    expect(sendMessage({ ...sent(), draft: "And?" }, "m2")).toBeUndefined();
  });

  it("carries an answer's anchor in as a chip, sent with the next message and then gone", () => {
    const anchor = { kind: "concern", id: "g1" } as const;
    const carried = carryAnchor(emptyChat(), anchor, "Retry the webhook");
    expect(carried.chip).toEqual({ anchor, label: "Retry the webhook" });

    const sending = sendMessage({ ...carried, draft: "Why now?" }, "m1");
    expect(sending?.message).toEqual({ text: "Why now?", anchor });
    expect(sending?.state.chip).toBeUndefined();
    expect(sending?.state.entries[0]).toEqual({
      kind: "message",
      id: "m1",
      text: "Why now?",
      chip: { anchor, label: "Retry the webhook" },
    });
  });

  it("drops the chip when the user removes it", () => {
    const carried = carryAnchor(
      emptyChat(),
      { kind: "concern", id: "g1" },
      "Retry the webhook",
    );
    expect(removeChip(carried).chip).toBeUndefined();
  });

  it("streams the reply in and ends it", () => {
    let state = sent();
    state = applyChatEvent(state, {
      type: "text",
      turnId: TURN,
      conversationId: CONVERSATION,
      index: 0,
      text: "Yes, ",
    });
    state = applyChatEvent(state, {
      type: "text",
      turnId: TURN,
      conversationId: CONVERSATION,
      index: 1,
      text: "it is.",
    });
    expect(state.entries[1]).toMatchObject({
      kind: "reply",
      state: { kind: "streaming", pieces: ["Yes, ", "it is."] },
    });

    state = applyChatEvent(state, {
      type: "ended",
      turnId: TURN,
      conversationId: CONVERSATION,
      outcome: "done",
    });
    expect(state.entries[1]).toMatchObject({
      kind: "reply",
      state: { kind: "answered", text: "Yes, it is." },
    });
    expect(chatGoing(state)).toBe(false);
  });

  it("shows each write as one action line before the reply, once", () => {
    const action = {
      type: "action" as const,
      turnId: TURN,
      conversationId: CONVERSATION,
      action: comment,
    };
    let state = applyChatEvent(sent(), action);
    // The stream replays a turn's events to a late watcher.
    state = applyChatEvent(state, action);

    expect(state.entries.map((entry) => entry.kind)).toEqual([
      "message",
      "action",
      "reply",
    ]);
    expect(state.entries[1]).toEqual({ kind: "action", action: comment });
  });

  it("ignores another turn's events", () => {
    const state = sent();
    expect(
      applyChatEvent(state, {
        type: "text",
        turnId: "turn-2",
        conversationId: CONVERSATION,
        index: 0,
        text: "Elsewhere",
      }),
    ).toBe(state);
  });

  it("fails a reply whose turn couldn't start, keeping the message", () => {
    const sending = sendMessage({ ...emptyChat(), draft: "Hi" }, "m1")!;
    const state = failReply(sending.state, "Pick an agent in Settings.");
    expect(state.entries[1]).toMatchObject({
      kind: "reply",
      state: { kind: "failed", message: "Pick an agent in Settings." },
    });
    expect(chatGoing(state)).toBe(false);
  });

  it("follows Delete on an action line: deleting, then deleted, or why not", () => {
    const state = applyChatEvent(sent(), {
      type: "action",
      turnId: TURN,
      conversationId: CONVERSATION,
      action: comment,
    });
    expect(markDeletion(state, comment.id, "deleting").entries[1]).toEqual({
      kind: "action",
      action: comment,
      deletion: "deleting",
    });
    expect(markDeletion(state, comment.id, "deleted").entries[1]).toEqual({
      kind: "action",
      action: comment,
      deletion: "deleted",
    });
    expect(
      markDeletion(state, comment.id, { failed: "GitHub is down." }).entries[1],
    ).toEqual({
      kind: "action",
      action: comment,
      deletion: { failed: "GitHub is down." },
    });
  });
});

describe("the chat's header", () => {
  it("names the pull request, the agent and what it reads", () => {
    expect(
      chatHeader({ number: 482, provider: "Claude Code", clone: "chosen" }),
    ).toEqual({ text: "#482 · Claude Code · PR + local clone" });
    expect(chatHeader({ number: 482, provider: "Claude Code" })).toEqual({
      text: "#482 · Claude Code · PR",
    });
    expect(
      chatHeader({
        number: 482,
        provider: "Claude Code",
        clone: { state: "read" },
      }),
    ).toEqual({ text: "#482 · Claude Code · PR + local clone" });
  });

  it("says the chat reads the pull request alone when the clone can't be read, and why", () => {
    expect(
      chatHeader({
        number: 482,
        provider: "Codex",
        clone: { state: "unavailable", reason: "Git couldn't fetch the head." },
      }),
    ).toEqual({
      text: "#482 · Codex · PR",
      cloneReason: "Git couldn't fetch the head.",
    });
  });

  it("leaves the agent out until Ajour knows which one Settings picks", () => {
    expect(chatHeader({ number: 482 })).toEqual({ text: "#482 · PR" });
  });
});
