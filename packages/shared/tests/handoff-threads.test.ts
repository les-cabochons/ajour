import { describe, expect, it } from "vitest";
import {
  MAX_THREAD_OFFERS,
  selectThreadOffers,
  threadTitleKeys,
  threadTitleNamesKey,
  type ListedHandoffThread,
} from "../handoff-threads.ts";

describe("threadTitleKeys", () => {
  it.each([
    ["[1234] Fix login redirect", ["1234"]],
    ["[PAY-12] Fix login redirect", ["PAY-12"]],
    ["[acme/api#12] Fix login redirect", ["acme/api#12"]],
    ["[PAY-12] [PAY-13] Split the job", ["PAY-12", "PAY-13"]],
    ["Fix [PAY-12] and [acme/api#12] together", ["PAY-12", "acme/api#12"]],
    ["[[PAY-12]] Doubled", ["PAY-12"]],
    ["No key at all", []],
    ["[] Empty [ ] blank", [" "]],
  ])("reads the bracketed tokens of %j", (title, keys) => {
    expect(threadTitleKeys(title)).toEqual(keys);
  });

  it("ignores a token that spans lines or never closes", () => {
    expect(threadTitleKeys("[PAY\n-12] [PAY-13")).toEqual([]);
  });
});

describe("threadTitleNamesKey", () => {
  it.each([
    ["[1234] Fix", "1234"],
    ["[PAY-12] Fix", "PAY-12"],
    ["[acme/api#12] Fix", "acme/api#12"],
    ["[PAY-11] [PAY-12] Two items", "PAY-12"],
    ["[PAY-11] [PAY-12] Two items", "PAY-11"],
    ["Fix it [PAY-12]", "PAY-12"],
    // An issue number, bare or with the hash people write before it.
    ["[12] Fix", "12"],
    ["[#12] Fix", "12"],
    ["[#1234] Fix", "1234"],
  ])("matches %j to %j", (title, key) => {
    expect(threadTitleNamesKey(title, [key])).toBe(true);
  });

  it.each([
    // A GitHub issue answers to its full name and to the number it shows.
    ["[acme/api#12] Fix", ["acme/api#12", "12"]],
    ["[12] Fix", ["acme/api#12", "12"]],
    ["[#12] Fix", ["acme/api#12", "12"]],
    // A Jira issue and an Azure DevOps work item show their own id.
    ["[PAY-12] Fix", ["PAY-12"]],
    ["[1234] Fix", ["1234"]],
    ["[#1234] Fix", ["1234"]],
  ])("matches %j to one of %j", (title, keys) => {
    expect(threadTitleNamesKey(title, keys)).toBe(true);
  });

  it.each([
    // Only an exact key counts.
    ["[12345] Fix", "1234"],
    ["[123] Fix", "1234"],
    ["[PAY-123] Fix", "PAY-12"],
    ["[pay-12] Fix", "PAY-12"],
    ["[ PAY-12 ] Fix", "PAY-12"],
    ["[#123] Fix", "1234"],
    ["[##1234] Fix", "1234"],
    ["[# 1234] Fix", "1234"],
    ["[#PAY-12] Fix", "PAY-12"],
    ["[#acme/api#12] Fix", "acme/api#12"],
    ["[acme/api#1] Fix", "acme/api#12"],
    ["[other/api#12] Fix", "acme/api#12"],
    // A key outside brackets, or brackets that aren't keys.
    ["PAY-12 Fix", "PAY-12"],
    ["[WIP] Fix PAY-12", "PAY-12"],
    ["(PAY-12) Fix", "PAY-12"],
    ["{PAY-12} Fix", "PAY-12"],
    // An item without a key matches nothing, even empty brackets.
    ["[] Fix", ""],
  ])("doesn't match %j to %j", (title, key) => {
    expect(threadTitleNamesKey(title, [key])).toBe(false);
  });

  it("matches nothing for an item without keys", () => {
    expect(threadTitleNamesKey("[12] Fix", [])).toBe(false);
    expect(threadTitleNamesKey("[12] Fix", ["", ""])).toBe(false);
  });
});

describe("selectThreadOffers", () => {
  const thread = (
    threadId: string,
    title: string,
    extra: Partial<ListedHandoffThread> = {},
  ): ListedHandoffThread => ({
    pluginId: "agent",
    toolId: "t3",
    folderId: "folder",
    threadId,
    title,
    native: {},
    ...extra,
  });

  it("offers the threads that name the key, newest first", () => {
    const offers = selectThreadOffers({
      keys: ["PAY-12"],
      workItemId: "item-12",
      threads: [
        thread("a", "[PAY-12] Old", { updatedAt: 1 }),
        thread("b", "[PAY-13] Other item", { updatedAt: 5 }),
        thread("c", "[PAY-11] [PAY-12] Both", { updatedAt: 3 }),
        thread("d", "[PAY-12] Undated"),
      ],
      handoffs: [],
      dismissals: [],
    });
    expect(offers.map((offer) => offer.threadId)).toEqual(["c", "a", "d"]);
  });

  it("skips threads already linked to any handoff, of any item", () => {
    const offers = selectThreadOffers({
      keys: ["PAY-12"],
      workItemId: "item-12",
      threads: [
        thread("linked", "[PAY-12] Linked"),
        thread("other-tool", "[PAY-12] Same id, other tool", {
          threadId: "linked",
          toolId: "claude",
        }),
        thread("other-connection", "[PAY-12] Same id, other server", {
          threadId: "linked",
          connectionId: "server-2",
        }),
      ],
      handoffs: [
        {
          pluginId: "agent",
          toolId: "t3",
          threadId: "linked",
        },
      ],
      dismissals: [],
    });
    expect(
      offers.map((offer) => [offer.toolId, offer.connectionId ?? null]),
    ).toEqual([
      ["claude", null],
      ["t3", "server-2"],
    ]);
  });

  it("skips threads dismissed for this item, by plugin, tool, connection and thread id", () => {
    const offers = selectThreadOffers({
      keys: ["PAY-12"],
      workItemId: "item-12",
      threads: [
        thread("dismissed", "[PAY-12] Not this one"),
        thread("kept", "[PAY-12] Still offered"),
        thread("dismissed", "[PAY-12] Same id, other tool", {
          toolId: "claude",
        }),
        thread("dismissed", "[PAY-12] Same id, other server", {
          connectionId: "server-2",
        }),
      ],
      handoffs: [],
      dismissals: [
        {
          pluginId: "agent",
          toolId: "t3",
          threadId: "dismissed",
          workItemId: "item-12",
        },
      ],
    });
    expect(
      offers.map((offer) => [
        offer.toolId,
        offer.connectionId ?? null,
        offer.threadId,
      ]),
    ).toEqual([
      ["t3", null, "kept"],
      ["claude", null, "dismissed"],
      ["t3", "server-2", "dismissed"],
    ]);
  });

  it("still offers a thread dismissed on one item to the other items its title names", () => {
    const threads = [thread("both", "[PAY-12] [PAY-13] Split the job")];
    const dismissals = [
      {
        pluginId: "agent",
        toolId: "t3",
        threadId: "both",
        workItemId: "item-12",
      },
    ];
    expect(
      selectThreadOffers({
        keys: ["PAY-12"],
        workItemId: "item-12",
        threads,
        handoffs: [],
        dismissals,
      }),
    ).toEqual([]);
    expect(
      selectThreadOffers({
        keys: ["PAY-13"],
        workItemId: "item-13",
        threads,
        handoffs: [],
        dismissals,
      }).map((offer) => offer.threadId),
    ).toEqual(["both"]);
  });

  it("offers a thread that names a key two items show on both, until it is linked to one", () => {
    // Issue 12 of two GitHub repositories in one project.
    const threads = [thread("t", "[12] Fix login redirect")];
    const select = (
      workItemId: string,
      keys: string[],
      handoffs: Array<{ pluginId: string; toolId: string; threadId: string }>,
    ) =>
      selectThreadOffers({
        keys,
        workItemId,
        threads,
        handoffs,
        dismissals: [],
      }).map((offer) => offer.threadId);
    expect(select("api-12", ["acme/api#12", "12"], [])).toEqual(["t"]);
    expect(select("web-12", ["acme/web#12", "12"], [])).toEqual(["t"]);
    const linked = [{ pluginId: "agent", toolId: "t3", threadId: "t" }];
    expect(select("api-12", ["acme/api#12", "12"], linked)).toEqual([]);
    expect(select("web-12", ["acme/web#12", "12"], linked)).toEqual([]);
  });

  it("offers a thread a tool lists in several folders once", () => {
    const offers = selectThreadOffers({
      keys: ["PAY-12"],
      workItemId: "item-12",
      threads: [
        thread("a", "[PAY-12] Fix", { folderId: "api" }),
        thread("a", "[PAY-12] Fix", { folderId: "web" }),
      ],
      handoffs: [],
      dismissals: [],
    });
    expect(offers.map((offer) => offer.folderId)).toEqual(["api"]);
  });

  it(`offers at most ${MAX_THREAD_OFFERS} threads, the newest`, () => {
    const offers = selectThreadOffers({
      keys: ["PAY-12"],
      workItemId: "item-12",
      threads: Array.from({ length: MAX_THREAD_OFFERS + 5 }, (_, index) =>
        thread(`t-${index}`, "[PAY-12] Fix", { updatedAt: index }),
      ),
      handoffs: [],
      dismissals: [],
    });
    expect(offers).toHaveLength(MAX_THREAD_OFFERS);
    expect(offers[0]!.threadId).toBe(`t-${MAX_THREAD_OFFERS + 4}`);
    expect(offers.at(-1)!.threadId).toBe("t-5");
  });

  it("offers nothing for an item without a key", () => {
    expect(
      selectThreadOffers({
        keys: [""],
        workItemId: "item-12",
        threads: [thread("a", "[] Empty")],
        handoffs: [],
        dismissals: [],
      }),
    ).toEqual([]);
  });
});
