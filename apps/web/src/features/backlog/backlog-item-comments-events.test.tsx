// @vitest-environment jsdom
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentSource } from "@/domain/backlog/comments";
import { BacklogItemComments } from "@/features/backlog/backlog-item-comments";
import { replaceEventSink } from "@/lib/wide-events";
import { installDomShims } from "@/test-support/dom";

/*
 * The renderer's hop of a comment list (#310): a load is the client's own
 * `comment.list` command, a thread the cache answers is one without a
 * request. Both name Ajour's item, never the item's ID in its source.
 */

const source: CommentSource = {
  pluginId: "azure_devops",
  connectionId: "ado-1",
  sourceId: "source-canary-101",
  capability: {},
};
/** Another thread for each test: the cache of first pages outlives a render. */
let thread = 0;
const nextSource = (): CommentSource => ({
  ...source,
  sourceId: `source-canary-${(thread += 1)}`,
});
const viewer = { id: "person-canary", displayName: "Canary Person" };

beforeEach(() => {
  installDomShims();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        viewer,
        comments: [
          {
            id: "comment-canary-1",
            author: viewer,
            body: "Canary body",
            createdAt: "2026-10-13T10:00:00Z",
          },
        ],
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a comment thread's events", () => {
  it("records a load as a miss and a return within the cache window as a hit", async () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);
    const fetch = globalThis.fetch as ReturnType<typeof vi.fn>;

    const first = render(
      <BacklogItemComments itemId="item-1" source={source} />,
    );
    await screen.findByText("Canary body");
    first.unmount();
    render(<BacklogItemComments itemId="item-1" source={source} />);
    await screen.findByText("Canary body");

    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        sink.events.filter((event) => event.name === "comment.list"),
      ).toHaveLength(2),
    );
    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "comment.list",
        kind: "command",
        runtime: "renderer",
        trigger: "user",
        outcome: "ok",
        backlog_item: { id: "item-1" },
        comment: { cache_hit: false },
      }),
      expect.objectContaining({
        name: "comment.list",
        kind: "command",
        runtime: "renderer",
        trigger: "user",
        outcome: "ok",
        backlog_item: { id: "item-1" },
        comment: { cache_hit: true },
      }),
    ]);
    expect(JSON.stringify(sink.events)).not.toMatch(/canary/i);
  });

  it("reports a hit once under StrictMode, which runs the effect twice", async () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);
    const strictSource = nextSource();
    const first = render(
      <BacklogItemComments itemId="item-2" source={strictSource} />,
    );
    await screen.findByText("Canary body");
    first.unmount();
    sink.events.length = 0;

    render(
      <StrictMode>
        <BacklogItemComments itemId="item-2" source={strictSource} />
      </StrictMode>,
    );
    await screen.findByText("Canary body");

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "comment.list",
        comment: { cache_hit: true },
      }),
    ]);
  });

  it("records an earlier page as a load, not a hit", async () => {
    const sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);
    const fetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetch.mockImplementationOnce(async () =>
      Response.json({
        viewer,
        comments: [
          {
            id: "comment-canary-2",
            author: viewer,
            body: "Canary newest",
            createdAt: "2026-10-14T10:00:00Z",
          },
        ],
        earlierCursor: "cursor-canary",
      }),
    );
    render(<BacklogItemComments itemId="item-3" source={nextSource()} />);
    fireEvent.click(await screen.findByText("Show earlier comments"));
    await screen.findByText("Canary body");

    await waitFor(() =>
      expect(
        sink.events.filter((event) => event.name === "comment.list"),
      ).toHaveLength(2),
    );
    expect(sink.events.map((event) => event.comment)).toEqual([
      { cache_hit: false },
      { cache_hit: false },
    ]);
    expect(JSON.stringify(sink.events)).not.toMatch(/canary/i);
  });
});
