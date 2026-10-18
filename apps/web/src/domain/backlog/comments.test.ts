import { describe, expect, it } from "vitest";
import type { BacklogComment, PluginsOverview } from "@ajour/shared";
import {
  commentSourceOf,
  firstNewCommentIndex,
  isEditedComment,
  mergeEarlierComments,
  withViewerReaction,
} from "@/domain/backlog/comments";

const viewer = { id: "me", displayName: "Me" };

function comment(
  id: string,
  createdAt: string,
  authorId = "ana",
  extra: Partial<BacklogComment> = {},
): BacklogComment {
  return {
    id,
    author: { id: authorId, displayName: authorId },
    body: id,
    createdAt,
    ...extra,
  };
}

function overview(
  comments: object | undefined,
  options: { enabled?: boolean; inactive?: boolean } = {},
): PluginsOverview {
  const plugin = {
    id: "azure_devops",
    displayName: "Azure DevOps",
    apiVersion: 3,
    capabilities: { connector: comments ? { comments } : {} },
  } as PluginsOverview["plugins"][number];
  return {
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: options.enabled ?? true,
        inactiveCapabilities: options.inactive ? ["connector"] : undefined,
        connections: [{ id: "conn-1" } as never],
      },
    ],
  } as unknown as PluginsOverview;
}

const synced = {
  source: "azure_devops",
  sourceId: "4821",
  sourceConnectionId: "conn-1",
};

describe("backlog comments", () => {
  it("finds the connection that serves a synced item's comments", () => {
    expect(commentSourceOf(synced, overview({ edit: true }))).toEqual({
      pluginId: "azure_devops",
      connectionId: "conn-1",
      sourceId: "4821",
      capability: { edit: true },
    });
  });

  it.each([
    ["a manual item", { source: "manual" }, overview({})],
    ["a plugin without comments", synced, overview(undefined)],
    ["a turned-off plugin", synced, overview({}, { enabled: false })],
    ["backlog items turned off", synced, overview({}, { inactive: true })],
    [
      "a removed connection",
      { ...synced, sourceConnectionId: "conn-2" },
      overview({}),
    ],
    ["no plugin overview yet", synced, null],
  ])("has no comments for %s", (_label, item, current) => {
    expect(commentSourceOf(item, current)).toBeUndefined();
  });

  it("puts the New divider before the first comment from someone else since the last visit", () => {
    const comments = [
      comment("old", "2026-10-13T10:00:00Z"),
      comment("mine", "2026-10-17T09:00:00Z", "me"),
      comment("new", "2026-10-17T10:42:00Z"),
    ];
    const seenAt = Date.parse("2026-10-16T00:00:00Z");

    expect(firstNewCommentIndex(comments, viewer, seenAt)).toBe(2);
    expect(firstNewCommentIndex(comments, viewer, undefined)).toBe(-1);
    expect(
      firstNewCommentIndex(comments, viewer, Date.parse("2026-10-18")),
    ).toBe(-1);
  });

  it("marks a comment edited only when it changed after it was posted", () => {
    expect(
      isEditedComment(
        comment("c", "2026-10-17T10:00:00Z", "ana", {
          updatedAt: "2026-10-17T11:00:00Z",
        }),
      ),
    ).toBe(true);
    expect(
      isEditedComment(
        comment("c", "2026-10-17T10:00:00Z", "ana", {
          updatedAt: "2026-10-17T10:00:00Z",
        }),
      ),
    ).toBe(false);
    expect(isEditedComment(comment("c", "2026-10-17T10:00:00Z"))).toBe(false);
  });

  it("puts earlier pages first without repeating a comment", () => {
    const loaded = [comment("b", "2"), comment("c", "3")];
    const earlier = [comment("a", "1"), comment("b", "2")];

    expect(
      mergeEarlierComments(earlier, loaded).map((entry) => entry.id),
    ).toEqual(["a", "b", "c"]);
  });
  it("adds, raises and lowers the user's reaction", () => {
    const like = { reaction: "like" as const, count: 2, viewerReacted: false };

    expect(withViewerReaction([like], "like", true)).toEqual([
      { reaction: "like", count: 3, viewerReacted: true },
    ]);
    expect(
      withViewerReaction([{ ...like, viewerReacted: true }], "like", false),
    ).toEqual([{ reaction: "like", count: 1, viewerReacted: false }]);
    expect(withViewerReaction([like], "heart", true)).toEqual([
      like,
      { reaction: "heart", count: 1, viewerReacted: true },
    ]);
    expect(withViewerReaction([like], "heart", false)).toEqual([like]);
  });
});
