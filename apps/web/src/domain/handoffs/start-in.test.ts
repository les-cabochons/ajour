import { describe, expect, it } from "vitest";
import type { RepositoryBranches, Worktree } from "@ajour/shared/worktrees";
import {
  defaultStartPlace,
  describeStartPlace,
  freeBranchName,
  getBranchNameRefusal,
  getNewWorktreeRefusal,
  getOwnWorktreeNote,
  getWorktreePath,
  summarizeStartPlace,
  type FolderStartOptions,
} from "./start-in";

const folder = {
  id: "folder-1",
  projectId: "project-1",
  name: "atlas-web",
  path: "/work/atlas-web",
};

const branches: RepositoryBranches = {
  current: "develop",
  source: "origin/main",
  branches: [
    { name: "origin/main", remote: true, default: true },
    { name: "develop", remote: false, current: true },
    { name: "4821-week-grid", remote: false },
  ],
};

const worktree: Worktree = {
  id: "worktree-1",
  repositoryFolderId: "folder-1",
  projectId: "project-1",
  workItemId: "item-1",
  itemKey: "4821",
  name: "aj-4821",
  branch: "4821-week-grid",
  source: "origin/main",
  createdAt: 1,
};

const options = (
  overrides: Partial<FolderStartOptions> = {},
): FolderStartOptions => ({ folder, branches, worktrees: [], ...overrides });

describe("where a start that names no place runs", () => {
  it("is the item's newest worktree, whatever Settings say", () => {
    for (const startIn of ["worktree", "main"] as const)
      expect(
        defaultStartPlace(startIn, options({ worktrees: [worktree] })),
      ).toEqual({ kind: "worktree", worktreeId: "worktree-1" });
  });

  it("is what Settings say for an item without a worktree", () => {
    expect(defaultStartPlace("worktree", options())).toEqual({ kind: "new" });
    expect(defaultStartPlace("main", options())).toEqual({ kind: "main" });
  });

  it("is the main folder where Ajour can't make a worktree", () => {
    expect(
      defaultStartPlace(
        "worktree",
        options({ branches: { unavailable: "not_repository", branches: [] } }),
      ),
    ).toEqual({ kind: "main" });
  });

  it("is asked for under Ask each time, even for an item with a worktree", () => {
    expect(
      defaultStartPlace("ask", options({ worktrees: [worktree] })),
    ).toEqual({ kind: "ask" });
  });
});

describe("the two lines of the Start in row", () => {
  it("names a new worktree and its source, which the user can change", () => {
    expect(describeStartPlace({ kind: "new" }, options())).toMatchObject({
      title: "New worktree",
      detail: "From origin/main",
      sourced: true,
    });
    expect(
      describeStartPlace({ kind: "new", source: "develop" }, options()),
    ).toMatchObject({ detail: "From develop" });
  });

  it("names no source when the folder's list can't say which one a start will use", () => {
    const { source: _source, ...unsourced } = branches;
    expect(
      describeStartPlace({ kind: "new" }, options({ branches: unsourced })),
    ).toMatchObject({ detail: "From the default branch", sourced: true });
    expect(
      summarizeStartPlace({ kind: "new" }, options({ branches: unsourced }), {
        branch: "4821-spike",
      }),
    ).toBe("New branch 4821-spike from the default branch");
  });

  it("names a previous worktree and its branch, as plain text", () => {
    expect(
      describeStartPlace(
        { kind: "worktree", worktreeId: "worktree-1" },
        options({ worktrees: [worktree] }),
      ),
    ).toMatchObject({
      title: "Start in aj-4821",
      detail: "4821-week-grid",
      sourced: false,
    });
  });

  it("names the main folder and the branch checked out there", () => {
    expect(describeStartPlace({ kind: "main" }, options())).toMatchObject({
      title: "Main folder",
      detail: "On develop",
      sourced: false,
    });
    // A folder that isn't a git repository has no branch to name.
    expect(
      describeStartPlace(
        { kind: "main" },
        options({ branches: { unavailable: "not_repository", branches: [] } }),
      ),
    ).toMatchObject({ detail: "atlas-web" });
  });
});

it("says why New worktree can't be chosen in a folder", () => {
  expect(getNewWorktreeRefusal(options())).toBeUndefined();
  expect(
    getNewWorktreeRefusal(
      options({ branches: { unavailable: "not_repository", branches: [] } }),
    ),
  ).toBe("atlas-web is not a git repository");
  expect(
    getNewWorktreeRefusal(
      options({ branches: { unavailable: "git_missing", branches: [] } }),
    ),
  ).toBe("This computer has no git");
});

it("gives a taken branch name -2, then -3, counting local branches only", () => {
  expect(freeBranchName("4821-spike", branches.branches)).toBe("4821-spike");
  expect(freeBranchName("4821-week-grid", branches.branches)).toBe(
    "4821-week-grid-2",
  );
  expect(
    freeBranchName("develop", [
      ...branches.branches,
      { name: "develop-2", remote: false },
    ]),
  ).toBe("develop-3");
  // A remote's branch of that name takes nothing.
  expect(freeBranchName("origin/main", branches.branches)).toBe("origin/main");
});

it("refuses a typed name git wouldn't take as a branch", () => {
  expect(getBranchNameRefusal("4821-spike")).toBeUndefined();
  expect(getBranchNameRefusal("bad branch")).toBe(
    "Not a valid git branch name.",
  );
  expect(getBranchNameRefusal("-option")).toBe("Not a valid git branch name.");
  // Git refuses a branch named HEAD.
  expect(getBranchNameRefusal("HEAD")).toBe("Not a valid git branch name.");
  expect(getBranchNameRefusal("HEAD-fix")).toBeUndefined();
});

it("builds a worktree's path in the folder's own path style", () => {
  expect(getWorktreePath("/work/atlas-web", "aj-4821")).toBe(
    "/work/atlas-web/.ajour/worktrees/aj-4821",
  );
  expect(getWorktreePath("C:\\work\\atlas-web", "aj-4821")).toBe(
    "C:\\work\\atlas-web\\.ajour\\worktrees\\aj-4821",
  );
  expect(getWorktreePath("/work/atlas-web/")).toBe(
    "/work/atlas-web/.ajour/worktrees",
  );
});

describe("the line that says what Hand off will do", () => {
  const template = { branch: "4821-week-grid" };

  it("names the new branch, with the suffix a taken name gets, and its source", () => {
    expect(summarizeStartPlace({ kind: "new" }, options(), template)).toBe(
      "New branch 4821-week-grid-2 from origin/main",
    );
    expect(
      summarizeStartPlace(
        { kind: "new", branch: "4821-spike", source: "develop" },
        options(),
        template,
      ),
    ).toBe("New branch 4821-spike from develop");
  });

  it("promises no branch name when the template fills empty: the new worktree's folder names it", () => {
    // The item has aj-4821, so the next folder, and its branch, is aj-4821-2.
    expect(
      summarizeStartPlace({ kind: "new" }, options({ worktrees: [worktree] }), {
        branch: "",
      }),
    ).toBe("New branch named after the new worktree, from origin/main");
  });

  it("names a previous worktree with its branch, and the main folder with its own", () => {
    expect(
      summarizeStartPlace(
        { kind: "worktree", worktreeId: "worktree-1" },
        options({ worktrees: [worktree] }),
        template,
      ),
    ).toBe("Starts in aj-4821, on 4821-week-grid");
    expect(summarizeStartPlace({ kind: "main" }, options(), template)).toBe(
      "Starts in atlas-web, on develop",
    );
  });
});

describe("a tool that makes its own worktree (#863)", () => {
  const template = { branch: "4821-week-grid" };
  const withWorktree = options({ worktrees: [worktree] });
  const previous = { kind: "worktree", worktreeId: "worktree-1" } as const;

  it("says on its row that it makes its own under New worktree, and that it can't join a worktree the item has", () => {
    expect(getOwnWorktreeNote({ kind: "new" }, options())).toBe(
      "Makes its own worktree",
    );
    expect(getOwnWorktreeNote(previous, withWorktree)).toBe(
      "Can't join aj-4821; makes its own",
    );
  });

  it("says nothing of a worktree in the main folder, or while the place is not known", () => {
    expect(getOwnWorktreeNote({ kind: "main" }, options())).toBeUndefined();
    expect(getOwnWorktreeNote({ kind: "ask" }, options())).toBeUndefined();
    expect(getOwnWorktreeNote(undefined, undefined)).toBeUndefined();
  });

  it("names the branch and the source the tool is told in the line that says what Hand off will do", () => {
    // A taken name shows with the -2 the local API tells the tool.
    expect(
      summarizeStartPlace({ kind: "new" }, options(), template, "Beta"),
    ).toBe("Beta makes its own worktree, on 4821-week-grid-2 from origin/main");
    expect(
      summarizeStartPlace(
        { kind: "new", branch: "4821-spike", source: "develop" },
        options(),
        template,
        "Beta",
      ),
    ).toBe("Beta makes its own worktree, on 4821-spike from develop");
    // A worktree the item has is a new one of the tool's, from the default
    // source. Its branch is the template's name, so the tool gets the next.
    expect(summarizeStartPlace(previous, withWorktree, template, "Beta")).toBe(
      "Can't join aj-4821; Beta makes its own, on 4821-week-grid-2 from origin/main",
    );
  });

  it("starts in the main folder like any tool", () => {
    expect(
      summarizeStartPlace({ kind: "main" }, options(), template, "Beta"),
    ).toBe("Starts in atlas-web, on develop");
  });
});
