import { expect, it } from "vitest";
import { worktreeBaseName, worktreeNameSchema } from "../worktrees.ts";

// The folder name of an item's first worktree (#857). Work item ids are the
// window's: `work_item_` and a UUID.
const FIRST = "work_item_1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const SECOND = "work_item_7c2a40e1-0d3f-4c58-8f4e-2f6f0a9b1c3d";

it("names a worktree after the item's key, as a slug cut to 23 characters", () => {
  expect(worktreeBaseName("4821", FIRST)).toBe("aj-4821");
  expect(worktreeBaseName("acme/api#12", FIRST)).toBe("aj-acme-api-12");
  // The cut leaves no dash at the end.
  expect(worktreeBaseName("a".repeat(22) + " bcd", FIRST)).toBe(
    `aj-${"a".repeat(22)}`,
  );
  expect(worktreeBaseName("x".repeat(60), FIRST)).toBe(`aj-${"x".repeat(23)}`);
});

it("names the worktree of an item without a key after the item's id, so two such items get two names", () => {
  // An item made by hand has no key.
  expect(worktreeBaseName("", FIRST)).toBe("aj-1b9d6bcd");
  expect(worktreeBaseName("", SECOND)).toBe("aj-7c2a40e1");
  // A key with no letter or digit slugs to nothing too.
  expect(worktreeBaseName(" #/ ", FIRST)).toBe("aj-1b9d6bcd");
  // An id of another shape: its whole text, as a slug, cut the same way.
  expect(worktreeBaseName("", "Item 42!")).toBe("aj-item-42");
  expect(worktreeBaseName("", "local-ab")).toBe("aj-local-ab");
  expect(worktreeBaseName("", "abcdefg-hij")).toBe("aj-abcdefg");
  for (const name of [
    worktreeBaseName("", FIRST),
    worktreeBaseName("", "abcdefg-hij"),
    worktreeBaseName("", "___"),
  ])
    expect(worktreeNameSchema.safeParse(name).success, name).toBe(true);
});
