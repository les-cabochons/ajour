import { describe, expect, it } from "vitest";
import type { PluginsOverview } from "@ajour/shared";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  descriptionAccess,
  descriptionCapabilityOf,
  newDescriptionConflicts,
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
