import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  createSharedTableDragPointerSession,
  getSharedTableDragTargetIndex,
  getSharedTableDropOrder,
  setSharedTableDragDocumentState,
  SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";

export interface BacklogDropTarget {
  key: string;
  itemIds: string[];
}

/**
 * Whether the dragged item moves among `itemId` in the custom order, such as
 * an item of its priority level. The dragged item is its own peer when it can
 * move at all. A callback that ignores `draggedId` makes every item it
 * accepts a peer of every other.
 */
export type BacklogReorderPeer = (itemId: string, draggedId: string) => boolean;

/** A drag needs either another destination in its lane or a peer to move among. */
export function canDragBacklogItem(
  targets: readonly BacklogDropTarget[],
  canReorder: BacklogReorderPeer,
  itemId: string,
  originKey: string,
) {
  const lane = originKey.split("/")[0];
  return targets.some(
    (target) =>
      target.key.split("/")[0] === lane &&
      (target.key !== originKey ||
        (canReorder(itemId, itemId) &&
          target.itemIds.includes(itemId) &&
          target.itemIds.some(
            (peerId) => peerId !== itemId && canReorder(peerId, itemId),
          ))),
  );
}

/**
 * The dragged item's peers in the target, in their new order, or null when
 * the drop changes nothing. Only the peers before `index` count, so a drop
 * beyond the first or last peer, such as past the edge of a priority level,
 * lands at that edge.
 */
export function getBacklogDropOrder(
  itemIds: string[],
  itemId: string,
  index: number,
  sameGroup: boolean,
  canReorder: BacklogReorderPeer,
) {
  const isPeer = (id: string) => canReorder(id, itemId);
  if (!isPeer(itemId)) return null;
  const others = itemIds.filter((id) => id !== itemId);
  const targetIndex = others.slice(0, index).filter(isPeer).length;
  const peers = itemIds.filter(isPeer);
  if (sameGroup)
    return getSharedTableDropOrder(peers, peers.indexOf(itemId), targetIndex);
  const order = peers.filter((id) => id !== itemId);
  order.splice(targetIndex, 0, itemId);
  return order;
}
/**
 * Where rows that never move, such as subitems under Custom ordering, sit
 * after a drop. The sidebar shows them below their parent, so they follow
 * the peer above them. The Backlog page keeps each in its own slot while the
 * peers trade theirs.
 */
export type BacklogFixedRows = "follow-peer" | "keep-slot";

/**
 * Where the dragged item would land, for a drop line: before the peer that
 * would follow it, or after the last peer. Undefined when the drop changes
 * nothing or the target has no peer. With `follow-peer`, rows that never
 * move and sit right below the last peer stay above the line. With
 * `keep-slot`, a move within its group marks the slot the item takes.
 */
export function getBacklogDropMark(
  drag: Pick<Drag, "itemId" | "originKey" | "targetKey" | "index"> | null,
  targets: readonly BacklogDropTarget[],
  canReorder: BacklogReorderPeer,
  fixedRows: BacklogFixedRows = "follow-peer",
): { itemId: string; edge: "before" | "after" } | undefined {
  const target = targets.find((candidate) => candidate.key === drag?.targetKey);
  if (!drag || !target) return undefined;
  const order = getBacklogDropOrder(
    target.itemIds,
    drag.itemId,
    drag.index,
    drag.originKey === drag.targetKey,
    canReorder,
  );
  if (!order) return undefined;
  const landed = order.indexOf(drag.itemId);
  const rows = target.itemIds;
  if (fixedRows === "keep-slot" && drag.originKey === drag.targetKey) {
    // The peers' rows are the slots, in order, and the item takes the one
    // at its new place. The line sits on that slot's far side from where
    // the item comes.
    const slots = rows.flatMap((id, row) => (order.includes(id) ? [row] : []));
    const slot = slots[landed]!;
    return {
      itemId: rows[slot]!,
      edge: slot > rows.indexOf(drag.itemId) ? "after" : "before",
    };
  }
  const next = order[landed + 1];
  if (next) return { itemId: next, edge: "before" };
  const last = order[landed - 1];
  if (!last) return undefined;
  const lastRow = rows.indexOf(last);
  const nextMovable = rows.findIndex(
    (id, row) => row > lastRow && canReorder(id, id),
  );
  return {
    itemId: rows[(nextMovable === -1 ? rows.length : nextMovable) - 1]!,
    edge: "after",
  };
}

interface Drag {
  itemId: string;
  originKey: string;
  targetKey: string | null;
  index: number;
  x: number;
  y: number;
  /** The pressed row's left edge, for an overlay that moves up and down only. */
  originLeft: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}
export function useBacklogDrag({
  targets,
  canReorder,
  disabled,
  onDrop,
}: {
  targets: BacklogDropTarget[];
  canReorder: BacklogReorderPeer;
  disabled: boolean;
  onDrop: (itemId: string, targetKey: string, order: string[] | null) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const current = useRef<Drag | null>(null);
  const session = useRef<SharedTableDragPointerSession | null>(null);
  const suppress = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const live = useRef({ targets, canReorder, onDrop });
  live.current = { targets, canReorder, onDrop };
  function reset() {
    session.current?.dispose();
    session.current = null;
    current.current = null;
    setDrag(null);
    setSharedTableDragDocumentState(false, "backlog-drag-active");
  }
  useEffect(
    () => () => {
      session.current?.dispose();
      setSharedTableDragDocumentState(false, "backlog-drag-active");
    },
    [],
  );
  const targetIdentity = targets
    .map((t) => `${t.key}:${t.itemIds.join(",")}`)
    .join("|");
  useEffect(() => {
    if (current.current) reset();
  }, [disabled, canReorder, targetIdentity]);
  function pointerDown(
    itemId: string,
    originKey: string,
    event: PointerEvent<HTMLElement>,
  ) {
    if (
      disabled ||
      !canDragBacklogItem(
        live.current.targets,
        live.current.canReorder,
        itemId,
        originKey,
      ) ||
      event.button !== 0 ||
      // Ctrl or Cmd click opens the item's source instead.
      event.ctrlKey ||
      event.metaKey ||
      !(event.target instanceof Element) ||
      !event.currentTarget.contains(event.target) ||
      event.target.closest('button,input,a,textarea,select,[role="menu"]')
    )
      return;
    session.current?.dispose();
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    element.setPointerCapture(event.pointerId);
    const start = {
      itemId,
      originKey,
      targetKey: originKey,
      index:
        live.current.targets
          .find((t) => t.key === originKey)
          ?.itemIds.indexOf(itemId) ?? 0,
      x: event.clientX,
      y: event.clientY,
      originLeft: rect.left,
      width: rect.width,
      height: rect.height,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    const move = (x: number, y: number) => {
      const d = current.current;
      if (!d) return;
      const hit = live.current.targets.find((t) => {
        if (t.key.split("/")[0] !== originKey.split("/")[0]) return false;
        const r = groupRefs.current.get(t.key)?.getBoundingClientRect();
        return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
      const ids = hit?.itemIds ?? [];
      const next = {
        ...d,
        x,
        y,
        targetKey: hit?.key ?? null,
        index: getSharedTableDragTargetIndex(ids, itemId, y, rowRefs.current),
      };
      current.current = next;
      setDrag(next);
    };
    session.current = createSharedTableDragPointerSession({
      captureTarget: element,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      originX: event.clientX,
      originY: event.clientY,
      isDragging: () => current.current !== null,
      onStart: (p) => {
        current.current = start;
        setSharedTableDragDocumentState(true, "backlog-drag-active");
        move(p.clientX, p.clientY);
      },
      onMove: (p) => move(p.clientX, p.clientY),
      onEnd: (commit) => {
        const d = current.current;
        suppress.current =
          performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
        reset();
        if (!commit || !d?.targetKey) return;
        const target = live.current.targets.find((t) => t.key === d.targetKey);
        if (!target) return;
        const order = getBacklogDropOrder(
          target.itemIds,
          itemId,
          d.index,
          d.originKey === d.targetKey,
          live.current.canReorder,
        );
        if (d.originKey !== d.targetKey || order)
          live.current.onDrop(itemId, d.targetKey, order);
      },
      onPressEnd: (cancelled) => {
        if (cancelled)
          suppress.current =
            performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
        session.current = null;
      },
    });
  }
  return {
    drag,
    rowRefs,
    groupRefs,
    pointerDown,
    canDrag: (itemId: string, originKey: string) =>
      !disabled && canDragBacklogItem(targets, canReorder, itemId, originKey),
    clickAllowed: () => performance.now() > suppress.current,
  };
}
