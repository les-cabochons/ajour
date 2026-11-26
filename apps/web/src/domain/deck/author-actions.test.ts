import { describe, expect, it } from "vitest";
import {
  authorActions,
  defaultCommitTitle,
  draftActionFailure,
  draftActionLabel,
  mergeBlocker,
  mergeMethodLabels,
  pendingMerge,
} from "./author-actions";

const facts = { title: "Stop retries on 410", number: 7 };

describe("authorActions", () => {
  it("are the author's, on an open pull request only", () => {
    expect(authorActions({ viewerIsAuthor: true, state: "open" })).toBe(true);
    expect(authorActions({ viewerIsAuthor: false, state: "open" })).toBe(false);
    expect(authorActions({ viewerIsAuthor: true, state: "merged" })).toBe(
      false,
    );
    expect(authorActions({ viewerIsAuthor: true, state: "closed" })).toBe(
      false,
    );
  });
});

describe("mergeMethodLabels", () => {
  it("names each method as GitHub does", () => {
    expect(mergeMethodLabels("github")).toEqual({
      merge: "Create a merge commit",
      squash: "Squash and merge",
      rebase: "Rebase and merge",
    });
  });

  it("names each method as Azure DevOps's merge types", () => {
    expect(mergeMethodLabels("azure_devops")).toEqual({
      merge: "Merge (no fast forward)",
      squash: "Squash commit",
      rebase: "Rebase and fast-forward",
    });
  });
});

describe("draftActionLabel", () => {
  it.each([
    ["github", true, "Ready for review"],
    ["github", false, "Convert to draft"],
    ["azure_devops", true, "Publish"],
    ["azure_devops", false, "Mark as draft"],
  ] as const)("on %s, a draft %s offers %s", (pluginId, draft, label) => {
    expect(draftActionLabel(pluginId, draft)).toBe(label);
  });
});

describe("draftActionFailure", () => {
  it.each([
    ["github", true, "Couldn't convert it to a draft"],
    ["github", false, "Couldn't mark it ready for review"],
    ["azure_devops", true, "Couldn't mark it as a draft"],
    ["azure_devops", false, "Couldn't publish it"],
  ] as const)(
    "on %s, turning draft %s fails as %s",
    (pluginId, toDraft, title) => {
      expect(draftActionFailure(pluginId, toDraft)).toBe(title);
    },
  );
});

describe("defaultCommitTitle", () => {
  it("is the pull request's title and number on GitHub, as its own default", () => {
    expect(defaultCommitTitle("github", "squash", facts)).toBe(
      "Stop retries on 410 (#7)",
    );
    expect(defaultCommitTitle("github", "merge", facts)).toBe(
      "Stop retries on 410 (#7)",
    );
  });

  it("is Azure DevOps's own default there", () => {
    expect(defaultCommitTitle("azure_devops", "squash", facts)).toBe(
      "Merged PR 7: Stop retries on 410",
    );
  });

  it("is none for a rebase, which makes no merge commit", () => {
    expect(defaultCommitTitle("github", "rebase", facts)).toBeUndefined();
    expect(defaultCommitTitle("azure_devops", "rebase", facts)).toBeUndefined();
  });
});

describe("mergeBlocker", () => {
  const GITHUB = { pluginId: "github", pluginName: "GitHub" };
  const AZURE = { pluginId: "azure_devops", pluginName: "Azure DevOps" };
  const ready = { draft: false, pushes: 0, methods: ["squash"] as const };

  it("lets a ready pull request merge with a method the repository allows", () => {
    expect(mergeBlocker(GITHUB, ready)).toBeUndefined();
  });

  it("refuses while a push came in after the head on screen", () => {
    expect(mergeBlocker(GITHUB, { ...ready, pushes: 1 })).toBe(
      "1 new push since you opened this pull request. Refresh to review it before merging.",
    );
    expect(mergeBlocker(AZURE, { ...ready, pushes: 2 })).toBe(
      "2 new pushes since you opened this pull request. Refresh to review them before merging.",
    );
  });

  it("names them iterations when the code host does", () => {
    expect(
      mergeBlocker(AZURE, { ...ready, pushes: 1, versionName: "iteration" }),
    ).toBe(
      "1 new iteration since you opened this pull request. Refresh to review it before merging.",
    );
  });

  it("refuses a draft, in the host's words", () => {
    expect(mergeBlocker(GITHUB, { ...ready, draft: true })).toBe(
      "This pull request is a draft. Mark it ready for review to merge it.",
    );
    expect(mergeBlocker(AZURE, { ...ready, draft: true })).toBe(
      "This pull request is a draft. Publish it to merge it.",
    );
  });

  it("says when the repository allows no method Deck offers", () => {
    expect(mergeBlocker(AZURE, { ...ready, methods: [] })).toBe(
      "This repository allows no merge method Deck offers. Merge it on Azure DevOps.",
    );
    expect(mergeBlocker(GITHUB, { ...ready, methods: [] })).toBe(
      "This repository allows no merge method Deck offers. Merge it on GitHub.",
    );
  });
});

describe("pendingMerge", () => {
  const open = { state: "open", mergeability: "unknown" } as const;

  it("keeps a merge the code host took completing until something tells how it went", () => {
    expect(pendingMerge(open, { synced: false })).toBe("completing");
    // Azure DevOps works the merge out again before it completes.
    expect(
      pendingMerge({ ...open, mergeability: "mergeable" }, { synced: false }),
    ).toBe("completing");
  });

  it("ends it once the pull request merged or closed", () => {
    expect(pendingMerge({ ...open, state: "merged" }, { synced: false })).toBe(
      "ended",
    );
    expect(pendingMerge({ ...open, state: "closed" }, { synced: false })).toBe(
      "ended",
    );
  });

  it("fails it when the sync after the merge finds the branches conflict", () => {
    expect(
      pendingMerge({ ...open, mergeability: "conflicting" }, { synced: true }),
    ).toBe("conflicting");
  });

  it("doesn't fail it on a conflict the facts held before that sync", () => {
    // Facts from before the merge: the code host took it, so it saw no conflict then.
    expect(
      pendingMerge({ ...open, mergeability: "conflicting" }, { synced: false }),
    ).toBe("completing");
  });

  it("ends it when the sync after the merge finds it still open, so Merge can ask again", () => {
    expect(pendingMerge(open, { synced: true })).toBe("ended");
  });
});
