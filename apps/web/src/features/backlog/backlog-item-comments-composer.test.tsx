// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentSource } from "@/domain/backlog/comments";
import type { LocalWorkItem } from "@/domain/local-state";
import type { OnSettled } from "@/features/backlog/settle-dialog";
import type { OnSnoozed } from "@/features/backlog/snooze-picker";
import { installDomShims } from "@/test-support/dom";

/*
 * The comment editor's split button (#487): which outcome each key and menu
 * item runs, what the button says, and where the draft ends up. CodeMirror
 * stands in as a textarea that submits on ⌘/Ctrl+Enter with the keys held.
 */

const mocks = vi.hoisted(() => ({
  workItems: [] as LocalWorkItem[],
  settle: vi.fn(),
  snooze: vi.fn(),
  post: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/components/markdown-editor", () => ({
  preloadMarkdownEditor: () => {},
  MarkdownEditor: (props: {
    "aria-label": string;
    value: string;
    onChange: (value: string) => void;
    onSubmitWithModifiers: (
      value: string,
      keys: { shift: boolean; alt: boolean },
    ) => void;
  }) => (
    <textarea
      aria-label={props["aria-label"]}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.ctrlKey) {
          props.onSubmitWithModifiers(props.value, {
            shift: event.shiftKey,
            alt: event.altKey,
          });
        }
      }}
    />
  ),
}));
vi.mock("@/features/backlog/settle-dialog", () => ({
  settleBacklogItem: mocks.settle,
  settleOpensDialog: () => false,
}));
vi.mock("@/features/backlog/snooze-picker", () => ({
  requestSnooze: mocks.snooze,
}));
vi.mock("@/features/backlog/comment-threads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/backlog/comment-threads")
  >()),
  postThreadComment: mocks.post,
}));
vi.mock("@/lib/local-hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/local-hooks")>()),
  useLocalWorkItems: () => mocks.workItems,
}));
vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast")>()),
  showErrorToast: mocks.error,
}));

const { BacklogItemComments } =
  await import("@/features/backlog/backlog-item-comments");

let thread = 0;
const viewer = { id: "me", displayName: "Alex" };

function item(status: LocalWorkItem["status"] = "active"): LocalWorkItem {
  return {
    _id: "item-1",
    title: "Item",
    status,
    source: "azure_devops",
    sourceId: "1",
    sourceConnectionId: "ado-1",
    createdAt: 1,
  };
}

/** Opens the editor on a fresh thread with `text` typed. */
async function openEditor(text = "Waiting on the client") {
  const source: CommentSource = {
    pluginId: "azure_devops",
    connectionId: "ado-1",
    sourceId: `source-${(thread += 1)}`,
    capability: {},
  };
  render(<BacklogItemComments itemId="item-1" source={source} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Leave a comment…" }),
  );
  const editor = screen.getByRole("textbox", { name: "New comment" });
  fireEvent.change(editor, { target: { value: text } });
  return editor;
}

const submit = (
  editor: HTMLElement,
  keys: { shiftKey?: boolean; altKey?: boolean } = {},
) => fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true, ...keys });

const button = (name: string) => screen.getByRole("button", { name });

/** The callback the last settle or snooze request got. */
const settled = () => mocks.settle.mock.calls.at(-1)![1].onSettled as OnSettled;
const snoozed = () => mocks.snooze.mock.calls.at(-1)![1].onSnoozed as OnSnoozed;

beforeEach(() => {
  installDomShims();
  localStorage.clear();
  vi.clearAllMocks();
  mocks.workItems = [item()];
  mocks.post.mockResolvedValue({
    id: "c2",
    author: viewer,
    body: "Waiting on the client",
    createdAt: "2026-11-02T10:00:00Z",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ viewer, comments: [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the comment editor's keys", () => {
  it("run the button's outcome with ⌘/Ctrl+Enter, and settle or snooze with Shift or Alt", async () => {
    localStorage.setItem("ajour.comment-outcome", "snooze");
    const editor = await openEditor();
    expect(button("Comment and snooze…")).toBeTruthy();

    submit(editor);
    expect(mocks.snooze).toHaveBeenCalledWith("item-1", {
      comment: "Waiting on the client",
      onSnoozed: expect.any(Function),
    });

    submit(editor, { shiftKey: true });
    expect(mocks.settle).toHaveBeenCalledWith(mocks.workItems[0], {
      comment: "Waiting on the client",
      onSettled: expect.any(Function),
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("show what Enter would run while Ctrl is held", async () => {
    const editor = await openEditor();

    fireEvent.keyDown(editor, { key: "Shift", ctrlKey: true, shiftKey: true });
    expect(button("Comment and settle")).toBeTruthy();
    fireEvent.keyUp(editor, { key: "Shift", ctrlKey: true });
    expect(button("Comment")).toBeTruthy();
    // Shift alone, as for a capital letter, changes nothing.
    fireEvent.keyDown(editor, { key: "Shift", shiftKey: true });
    expect(button("Comment")).toBeTruthy();
  });
});

describe("an item that can't take the saved outcome", () => {
  it("shows Comment, posts with ⌘/Ctrl+Enter, and keeps the saved outcome", async () => {
    localStorage.setItem("ajour.comment-outcome", "snooze");
    mocks.workItems = [item("settled")];
    const editor = await openEditor();
    expect(button("Comment")).toBeTruthy();

    submit(editor, { altKey: true });
    expect(mocks.snooze).not.toHaveBeenCalled();
    submit(editor);

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        expect.objectContaining({ pluginId: "azure_devops" }),
        "item-1",
        "Waiting on the client",
      ),
    );
    expect(mocks.snooze).not.toHaveBeenCalled();
    expect(localStorage.getItem("ajour.comment-outcome")).toBe("snooze");
  });
});

describe("the outcome menu", () => {
  it("runs a pick at once, and the button keeps it once the item is settled", async () => {
    await openEditor();

    fireEvent.click(button("Other ways to comment"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Comment and settle" }),
    );
    expect(mocks.settle).toHaveBeenCalledOnce();
    // Nothing is cleared or saved before the settle is made.
    expect(screen.getByRole("textbox", { name: "New comment" })).toHaveProperty(
      "value",
      "Waiting on the client",
    );

    settled()({ commentQueued: true });

    expect(
      await screen.findByRole("button", { name: "Leave a comment…" }),
    ).toBeTruthy();
    expect(localStorage.getItem("ajour.comment-outcome")).toBe("settle");
    fireEvent.click(button("Leave a comment…"));
    expect(button("Comment and settle")).toBeTruthy();
  });

  it("greys out an outcome the item can't take, with the reason", async () => {
    mocks.workItems = [item("settled")];
    await openEditor();

    fireEvent.click(button("Other ways to comment"));
    const snooze = await screen.findByRole("menuitem", {
      name: /^Comment and snooze…/,
    });
    expect(snooze.getAttribute("aria-disabled")).toBe("true");
    expect(snooze.textContent).toContain("Unsettle the item first");
  });
});

describe("the draft", () => {
  it("stays when the snooze picker closes without a time", async () => {
    const editor = await openEditor();

    submit(editor, { altKey: true });

    expect(mocks.snooze).toHaveBeenCalledOnce();
    expect(editor).toHaveProperty("value", "Waiting on the client");
    expect(localStorage.getItem("ajour.comment-outcome")).toBeNull();
  });

  it("stays, with an error, when the snooze is made but its comment couldn't go", async () => {
    const editor = await openEditor();
    submit(editor, { altKey: true });

    snoozed()({ commentQueued: false });

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Your comment wasn't posted" }),
      ),
    );
    expect(editor).toHaveProperty("value", "Waiting on the client");
    expect(localStorage.getItem("ajour.comment-outcome")).toBe("snooze");
  });
});
