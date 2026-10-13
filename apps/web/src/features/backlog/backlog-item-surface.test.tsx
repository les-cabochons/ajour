import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BacklogItemSurface } from "./backlog-item-surface";
import { BacklogPeek } from "./backlog-peek";
import { DEFAULT_BACKLOG_VIEW_SETTINGS } from "@/domain/backlog/backlog-view";
import type { LocalWorkItem } from "@/domain/local-state";
import { localStore } from "@/lib/local-store";
const alternatives = vi.hoisted(() => vi.fn());
vi.mock("@/features/backlog/backlog-item-moves", () => ({
  getOtherSourceStates: alternatives,
  moveBacklogItemWithUndo: vi.fn(),
  changeSourceStateWithUndo: vi.fn(),
}));
const item: LocalWorkItem = {
  _id: "a",
  title: "Synced item",
  status: "active",
  source: "azure_devops",
  sourceId: "1",
  sourceConnectionId: "c",
  sourceStatusLabel: "Active",
  createdAt: 1,
};
const noop = () => {};
afterEach(() => vi.unstubAllGlobals());
describe.each([0, 1])(
  "inline source-state picker with %i alternatives",
  (count) => {
    it("uses the same availability in a row and the peek", () => {
      vi.stubGlobal("window", {
        localStorage: {
          length: 0,
          getItem: () => null,
          key: () => null,
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      });
      alternatives.mockReturnValue(
        Array.from({ length: count }, () => ({
          key: "blocked",
          label: "Blocked",
        })),
      );
      const state = { ...localStore.snapshot(), workItems: [item] };
      const peek = renderToStaticMarkup(
        <BacklogPeek
          item={item}
          state={state}
          now={1}
          onClose={noop}
          onOpen={noop}
          onAction={noop}
          onSelect={noop}
        />,
      );
      const row = renderToStaticMarkup(
        <BacklogItemSurface
          item={item}
          state={state}
          view={{
            ...DEFAULT_BACKLOG_VIEW_SETTINGS,
            properties: {
              ...DEFAULT_BACKLOG_VIEW_SETTINGS.properties,
              sourceState: true,
            },
          }}
          icons={{
            projectsById: new Map(),
            connectorIconsBySource: {},
            connectorCurrentColor: "currentColor",
            connectorTaskIconModesByConnectionId: {},
          }}
          board={false}
          column={0}
          now={1}
          selected={false}
          onSelect={noop}
          onOpen={noop}
          onAction={noop}
          onKeyDown={noop}
          onPointerDown={noop}
          beforeChange={() => true}
        />,
      );
      for (const html of [row, peek]) {
        const button = html.match(
          /<button[^>]*aria-label="Change source state of Synced item"[^>]*>/,
        )?.[0];
        expect(button).toBeDefined();
        expect(button!.includes('disabled=""')).toBe(count === 0);
      }
    });
  },
);
