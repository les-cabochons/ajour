import { describe, expect, it } from "vitest";
import type { PluginsOverview } from "@ajour/shared";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  descriptionAccess,
  descriptionCapabilityOf,
  descriptionInConflict,
  descriptionLimit,
  descriptionSaved,
  descriptionWriteFailed,
  rebaseDescriptionDraft,
  hasUnwrittenDescription,
  latestDescription,
  lostFormatting,
  newDescriptionConflicts,
  planDescriptionSave,
  planKeepMine,
  sourceDescriptionChanged,
  takeSourceDescription,
  importedDescription,
  reconcileDescription,
} from "@/domain/backlog/description-sync";

const NOW = 1_760_000_000_000;

type Described = Pick<LocalWorkItem, "description" | "descriptionSync">;

function synced(
  local: string | undefined,
  baseline: string | undefined,
): Described {
  return {
    description: local,
    descriptionSync: { baseline, remote: baseline ?? "" },
  };
}

describe("importing a synced description", () => {
  it("takes the source's text, which both sides then agree on", () => {
    expect(importedDescription({ text: "\nFix the login\r\n" })).toEqual({
      description: "Fix the login",
      descriptionSync: { baseline: "Fix the login", remote: "Fix the login" },
    });
  });

  it("keeps the first line's indentation, as an indented code block needs", () => {
    const code = "    first line\n    second line";
    expect(importedDescription({ text: code }).description).toBe(code);
    expect(
      reconcileDescription(synced("Old", "Old"), { text: `\n${code}\n` }, NOW)
        .description,
    ).toBe(code);
  });

  it("keeps what the conversion lost and whether the text was cut", () => {
    expect(
      importedDescription({ text: "", lost: ["text colour"], cut: true }),
    ).toEqual({
      description: undefined,
      descriptionSync: {
        baseline: "",
        remote: "",
        lost: ["text colour"],
        cut: true,
      },
    });
  });
});

describe("reconciling a synced description", () => {
  it("follows the source while the local text is unchanged", () => {
    expect(
      reconcileDescription(synced("Old", "Old"), { text: "New" }, NOW),
    ).toEqual({
      description: "New",
      descriptionSync: { baseline: "New", remote: "New" },
    });
  });

  it("keeps a local edit while the source is unchanged", () => {
    expect(
      reconcileDescription(synced("Mine", "Old"), { text: "Old" }, NOW),
    ).toEqual({
      description: "Mine",
      descriptionSync: { baseline: "Old", remote: "Old" },
    });
  });

  it("agrees again when both sides made the same change", () => {
    expect(
      reconcileDescription(synced("Same", "Old"), { text: "Same" }, NOW),
    ).toEqual({
      description: "Same",
      descriptionSync: { baseline: "Same", remote: "Same" },
    });
  });

  it("records a conflict when both sides changed, and keeps the local text", () => {
    expect(
      reconcileDescription(synced("Mine", "Old"), { text: "Theirs" }, NOW),
    ).toEqual({
      description: "Mine",
      descriptionSync: {
        baseline: "Old",
        remote: "Theirs",
        conflict: { detectedAt: NOW, localText: "Mine", remoteText: "Theirs" },
      },
    });
  });

  it("keeps when a conflict was first seen while its texts stay the same", () => {
    const first = reconcileDescription(
      synced("Mine", "Old"),
      { text: "Theirs" },
      NOW,
    );
    const again = reconcileDescription(first, { text: "Theirs" }, NOW + 60_000);
    expect(again.descriptionSync?.conflict?.detectedAt).toBe(NOW);

    const moved = reconcileDescription(
      again,
      { text: "Theirs, later" },
      NOW + 120_000,
    );
    expect(moved.descriptionSync?.conflict).toEqual({
      detectedAt: NOW + 120_000,
      localText: "Mine",
      remoteText: "Theirs, later",
    });
  });

  it("clears a conflict once the local text follows the source again", () => {
    const conflicted = reconcileDescription(
      synced("Mine", "Old"),
      { text: "Theirs" },
      NOW,
    );
    expect(
      reconcileDescription(
        { ...conflicted, description: "Theirs" },
        { text: "Theirs" },
        NOW,
      ),
    ).toEqual({
      description: "Theirs",
      descriptionSync: { baseline: "Theirs", remote: "Theirs" },
    });
  });

  it("compares texts without their outer whitespace or line endings", () => {
    expect(
      reconcileDescription(
        synced("Line one\nLine two", "Old"),
        { text: "Line one\r\nLine two\n" },
        NOW,
      ),
    ).toEqual({
      description: "Line one\nLine two",
      descriptionSync: {
        baseline: "Line one\nLine two",
        remote: "Line one\nLine two",
      },
    });
  });

  it("keeps an indented list's and code fence's first line as written", () => {
    const list = "  - First\n  - Second";
    expect(importedDescription({ text: list }).description).toBe(list);
    const fence = "  ```\n  code\n  ```";
    expect(importedDescription({ text: `\n${fence}\n` }).description).toBe(
      fence,
    );
  });

  it("counts a change to a first line's indentation as an edit", () => {
    const code = "    echo hi";
    expect(
      reconcileDescription(synced("echo hi", code), { text: code }, NOW),
    ).toEqual({
      description: "echo hi",
      descriptionSync: { baseline: code, remote: code },
    });
  });

  it("refreshes what was lost and cut on every sync", () => {
    expect(
      reconcileDescription(
        synced("Old", "Old"),
        { text: "Old", lost: ["underline"], cut: true },
        NOW,
      ),
    ).toEqual({
      description: "Old",
      descriptionSync: {
        baseline: "Old",
        remote: "Old",
        lost: ["underline"],
        cut: true,
      },
    });
  });

  describe("an item synced before descriptions were", () => {
    const before = (local: string | undefined): Described => ({
      description: local,
    });

    it("takes the source's text over an empty description", () => {
      expect(
        reconcileDescription(before(undefined), { text: "New" }, NOW),
      ).toEqual({
        description: "New",
        descriptionSync: { baseline: "New", remote: "New" },
      });
    });

    it("takes the source's text over the same text", () => {
      expect(
        reconcileDescription(before("Same"), { text: "Same" }, NOW)
          .descriptionSync,
      ).toEqual({
        baseline: "Same",
        remote: "Same",
      });
    });

    it("takes the source's text over the 4,000-character note it was once cut to", () => {
      const full = `${"word ".repeat(1000)}end`;
      const oldNote = `${full.slice(0, 3997).trimEnd()}...`;
      expect(
        reconcileDescription(before(oldNote), { text: full }, NOW),
      ).toEqual({
        description: full,
        descriptionSync: { baseline: full, remote: full },
      });
    });

    it("records a conflict rather than lose a local edit", () => {
      expect(
        reconcileDescription(before("My notes"), { text: "Theirs" }, NOW),
      ).toEqual({
        description: "My notes",
        descriptionSync: {
          remote: "Theirs",
          conflict: {
            detectedAt: NOW,
            localText: "My notes",
            remoteText: "Theirs",
          },
        },
      });
    });
  });
});

describe("who may edit a description", () => {
  const writable = { write: true };
  const item = (overrides: Partial<LocalWorkItem> = {}) =>
    ({
      status: "active",
      source: "azure_devops",
      ...overrides,
    }) as LocalWorkItem;

  it("lets anyone edit a description that is not synced, unless archived", () => {
    expect(descriptionAccess(item({ source: "manual" }), undefined)).toEqual({
      editable: true,
    });
    expect(descriptionAccess(item(), undefined)).toEqual({ editable: true });
    expect(descriptionAccess(item({ status: "archived" }), undefined)).toEqual({
      editable: false,
      reason: "archived",
    });
  });

  it("lets the user edit a synced description the plugin writes back", () => {
    expect(
      descriptionAccess(
        item({ descriptionSync: { baseline: "A", remote: "A" } }),
        writable,
      ),
    ).toEqual({ editable: true });
  });

  it("keeps a synced description read-only when the plugin cannot write it", () => {
    const syncedItem = item({
      descriptionSync: { baseline: "A", remote: "A" },
    });
    expect(descriptionAccess(syncedItem, {})).toEqual({
      editable: false,
      reason: "notWritable",
    });
    expect(descriptionAccess(syncedItem, undefined)).toEqual({
      editable: false,
      reason: "notWritable",
    });
  });

  it("keeps a cut description read-only, so a shortened copy is never written", () => {
    expect(
      descriptionAccess(
        item({ descriptionSync: { baseline: "A", remote: "A", cut: true } }),
        writable,
      ),
    ).toEqual({ editable: false, reason: "cut" });
  });

  it("keeps a description whose conversion lost formatting read-only", () => {
    expect(
      descriptionAccess(
        item({
          descriptionSync: { baseline: "A", remote: "A", lost: ["underline"] },
        }),
        writable,
      ),
    ).toEqual({ editable: false, reason: "lossy" });
    expect(lostFormatting(["colour", "underline", "tables"])).toBe(
      "colour, underline and tables",
    );
    expect(lostFormatting(["underline"])).toBe("underline");
  });
});

describe("the plugin's description support", () => {
  function overview(
    description: object | undefined,
    inactive = false,
  ): PluginsOverview {
    const plugin = {
      id: "azure_devops",
      capabilities: { connector: description ? { description } : {} },
    };
    return {
      pluginsEnabled: true,
      plugins: [plugin],
      connectionGroups: [
        {
          plugin,
          enabled: true,
          inactiveCapabilities: inactive ? ["connector"] : undefined,
          connections: [{ id: "conn-1" }],
        },
      ],
    } as unknown as PluginsOverview;
  }
  const item = { source: "azure_devops", sourceConnectionId: "conn-1" };

  it("is the plugin's declared description support", () => {
    expect(
      descriptionCapabilityOf(item, overview({ write: true, maxLength: 5 })),
    ).toEqual({
      write: true,
      maxLength: 5,
    });
  });

  it("is unknown for manual items, a gone connection, an inactive backlog or no overview", () => {
    expect(
      descriptionCapabilityOf({ source: "manual" }, overview({ write: true })),
    ).toBeUndefined();
    expect(
      descriptionCapabilityOf(
        { ...item, sourceConnectionId: "conn-2" },
        overview({ write: true }),
      ),
    ).toBeUndefined();
    expect(
      descriptionCapabilityOf(item, overview({ write: true }, true)),
    ).toBeUndefined();
    expect(descriptionCapabilityOf(item, undefined)).toBeUndefined();
  });
});

describe("resolving a description conflict", () => {
  const conflicted = reconcileDescription(
    synced("Mine", "Old"),
    { text: "Theirs", lost: ["underline"] },
    NOW,
  );

  it("takes the source's text, which both sides then agree on", () => {
    expect(takeSourceDescription(conflicted)).toEqual({
      description: "Theirs",
      descriptionSync: {
        baseline: "Theirs",
        remote: "Theirs",
        lost: ["underline"],
      },
    });
  });

  it("leaves a description without a conflict alone", () => {
    const agreed = synced("Same", "Same");
    expect(takeSourceDescription(agreed)).toBe(agreed);
  });

  it("finds the items a sync newly put in conflict", () => {
    const item = (id: string, sync?: LocalWorkItem["descriptionSync"]) =>
      ({ _id: id, descriptionSync: sync }) as LocalWorkItem;
    const conflict = conflicted.descriptionSync;

    expect(
      newDescriptionConflicts(
        [item("a", conflict), item("b"), item("c")],
        [item("a", conflict), item("b", conflict), item("c")],
      ).map((entry) => entry._id),
    ).toEqual(["b"]);
  });
});

describe("planning the save of an edited description", () => {
  const base = "Goal\n\nSteps\n\nDone when";

  it("writes the user's text when the source did not change", () => {
    expect(
      planDescriptionSave(base, "Goal\n\nNew steps\n\nDone when", base),
    ).toEqual({
      kind: "write",
      text: "Goal\n\nNew steps\n\nDone when",
      merged: false,
    });
  });

  it("merges changes to different lines, and writes the result", () => {
    expect(
      planDescriptionSave(
        base,
        "Goal\n\nNew steps\n\nDone when",
        "New goal\n\nSteps\n\nDone when",
      ),
    ).toEqual({
      kind: "write",
      text: "New goal\n\nNew steps\n\nDone when",
      merged: true,
    });
  });

  it("is a conflict when both changed the same lines", () => {
    expect(
      planDescriptionSave(
        base,
        "Goal\n\nMy steps\n\nDone when",
        "Goal\n\nTheir steps\n\nDone when",
      ),
    ).toEqual({ kind: "conflict" });
  });

  it("writes nothing when the source already holds the result", () => {
    expect(planDescriptionSave(base, "Same", "Same\r\n")).toEqual({
      kind: "agreed",
    });
    // The user's change is part of the source's.
    expect(
      planDescriptionSave(
        "One\nTwo",
        "One\nTwo\nThree",
        "Zero\nOne\nTwo\nThree",
      ),
    ).toEqual({ kind: "agreed" });
  });

  it("writes an emptied description, and merges into an empty one", () => {
    expect(planDescriptionSave("Old", "", "Old")).toEqual({
      kind: "write",
      text: "",
      merged: false,
    });
    expect(planDescriptionSave("", "Mine", "")).toEqual({
      kind: "write",
      text: "Mine",
      merged: false,
    });
    expect(planDescriptionSave("", "Mine", "Theirs")).toEqual({
      kind: "conflict",
    });
  });

  it("is a conflict for any difference before both sides first agreed", () => {
    expect(planDescriptionSave(undefined, "Mine", "Theirs")).toEqual({
      kind: "conflict",
    });
    expect(planDescriptionSave(undefined, "Same", "Same")).toEqual({
      kind: "agreed",
    });
  });
});

describe("keeping the user's side of a conflict", () => {
  const conflicted = reconcileDescription(
    synced("Mine", "Old"),
    { text: "Theirs" },
    NOW,
  );

  it("writes the user's text over the source's text they saw", () => {
    expect(planKeepMine(conflicted, "Theirs")).toEqual({
      kind: "write",
      text: "Mine",
      merged: false,
    });
  });

  it("is a new conflict when the source changed again since", () => {
    expect(planKeepMine(conflicted, "Theirs, again")).toEqual({
      kind: "conflict",
    });
  });
});

describe("after a save", () => {
  it("agrees on what the source holds, and shows it", () => {
    const saved = descriptionSaved(
      synced("Mine", "Old"),
      "Mine",
      { text: "Mine, merged" },
      NOW,
    );
    expect(saved).toEqual({
      description: "Mine, merged",
      descriptionSync: { baseline: "Mine, merged", remote: "Mine, merged" },
    });
  });

  it("keeps a text the user changed again meanwhile, for the next save", () => {
    expect(
      descriptionSaved(
        synced("Mine, later", "Old"),
        "Mine",
        { text: "Mine" },
        NOW,
      ),
    ).toEqual({
      description: "Mine, later",
      descriptionSync: { baseline: "Mine", remote: "Mine" },
    });
  });

  it("takes what the save merged from the source into a text changed meanwhile", () => {
    expect(
      descriptionSaved(
        synced("My newer title\nSteps", "Title\nSteps"),
        "My title\nSteps",
        { text: "My title\nNew steps" },
        NOW,
      ),
    ).toEqual({
      description: "My newer title\nNew steps",
      descriptionSync: {
        baseline: "My title\nNew steps",
        remote: "My title\nNew steps",
      },
    });
  });

  it("puts a text changed meanwhile in the same lines in conflict, and a sync keeps it", () => {
    const saved = descriptionSaved(
      synced("My title\nMy steps", "Title\nSteps"),
      "My title\nSteps",
      { text: "My title\nNew steps" },
      NOW,
    );
    expect(saved).toEqual({
      description: "My title\nMy steps",
      descriptionSync: {
        baseline: "My title\nSteps",
        remote: "My title\nNew steps",
        conflict: {
          detectedAt: NOW,
          localText: "My title\nMy steps",
          remoteText: "My title\nNew steps",
        },
      },
    });
    expect(
      reconcileDescription(saved, { text: "My title\nNew steps" }, NOW + 1)
        .descriptionSync?.conflict?.detectedAt,
    ).toBe(NOW);
  });

  it("clears a write error and a conflict", () => {
    const failed = descriptionWriteFailed(synced("Mine", "Old"), "No", NOW);
    expect(descriptionSaved(failed, "Mine", { text: "Mine" }, NOW)).toEqual({
      description: "Mine",
      descriptionSync: { baseline: "Mine", remote: "Mine" },
    });
  });

  it("records a conflict with the source's text, keeping the user's", () => {
    expect(
      descriptionInConflict(synced("Mine", "Old"), { text: "Theirs" }, NOW),
    ).toEqual({
      description: "Mine",
      descriptionSync: {
        baseline: "Old",
        remote: "Theirs",
        conflict: { detectedAt: NOW, localText: "Mine", remoteText: "Theirs" },
      },
    });
  });

  it("keeps why a write failed until a sync or a save settles the text", () => {
    const failed = descriptionWriteFailed(
      synced("Mine", "Old"),
      "The token expired.",
      NOW,
    );
    expect(failed.descriptionSync?.writeError).toEqual({
      at: NOW,
      message: "The token expired.",
    });
    expect(hasUnwrittenDescription(failed)).toBe(true);
    // A sync while the source is unchanged keeps the unwritten edit and why.
    expect(
      reconcileDescription(failed, { text: "Old" }, NOW + 1).descriptionSync
        ?.writeError,
    ).toEqual({ at: NOW, message: "The token expired." });
    // One that brings the source to the same text settles it.
    expect(
      reconcileDescription(failed, { text: "Mine" }, NOW + 1).descriptionSync
        ?.writeError,
    ).toBeUndefined();
  });

  it("leaves an item without description sync alone", () => {
    const local = { description: "Mine" };
    expect(descriptionWriteFailed(local, "No", NOW)).toBe(local);
  });
});

describe("an open draft when the text changes under it", () => {
  it("takes the new text while untouched", () => {
    expect(rebaseDescriptionDraft("A", "A", "B")).toEqual({ text: "B" });
  });

  it("takes in a change to other lines than the user's", () => {
    expect(
      rebaseDescriptionDraft(
        "Title\nSteps",
        "My title\nSteps",
        "Title\nNew steps",
      ),
    ).toEqual({ text: "My title\nNew steps" });
  });

  it("is a conflict when the change is to the user's lines", () => {
    expect(
      rebaseDescriptionDraft(
        "Title\nSteps",
        "My title\nSteps",
        "Their title\nSteps",
      ),
    ).toEqual({ conflict: true });
  });
});

describe("the editor's view of the source", () => {
  it("sees a change since both sides last agreed", () => {
    expect(
      sourceDescriptionChanged(synced("Old", "Old"), { text: "New" }),
    ).toBe(true);
    expect(
      sourceDescriptionChanged(synced("Mine", "Old"), { text: "Old\r\n" }),
    ).toBe(false);
    // Before both sides first agreed, a sync shows the conflict instead.
    expect(
      sourceDescriptionChanged(synced("Mine", undefined), { text: "New" }),
    ).toBe(false);
  });

  it("loads the latest text, which both sides then agree on", () => {
    expect(latestDescription({ text: "New\n", lost: ["colour"] })).toEqual({
      description: "New",
      descriptionSync: { baseline: "New", remote: "New", lost: ["colour"] },
    });
  });

  it("finds a local edit not written yet, but not a conflict", () => {
    expect(hasUnwrittenDescription(synced("Mine", "Old"))).toBe(true);
    expect(hasUnwrittenDescription(synced("Old", "Old"))).toBe(false);
    expect(
      hasUnwrittenDescription(
        reconcileDescription(synced("Mine", "Old"), { text: "Theirs" }, NOW),
      ),
    ).toBe(false);
    expect(hasUnwrittenDescription({ description: "Local" })).toBe(false);
  });

  it("limits the editor to what Ajour stores, or less when the source takes less", () => {
    expect(descriptionLimit(undefined)).toBe(64_000);
    expect(descriptionLimit({ write: true })).toBe(64_000);
    expect(descriptionLimit({ write: true, maxLength: 1_000_000 })).toBe(
      64_000,
    );
    expect(descriptionLimit({ write: true, maxLength: 4_000 })).toBe(4_000);
  });
});
