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

/** A drag needs either another destination in its lane or a reorderable peer. */
export function canDragBacklogItem(
  targets: readonly BacklogDropTarget[],
  canReorder: (itemId: string) => boolean,
  itemId: string,
  originKey: string,
) {
  const lane = originKey.split("/")[0];
  return targets.some(
    (target) =>
      target.key.split("/")[0] === lane &&
      (target.key !== originKey ||
        (canReorder(itemId) &&
          target.itemIds.includes(itemId) &&
          target.itemIds.some(
            (peerId) => peerId !== itemId && canReorder(peerId),
          ))),
  );
}

export function getBacklogDropOrder(
  itemIds: string[],
  itemId: string,
  index: number,
  sameGroup: boolean,
  canReorder: (itemId: string) => boolean,
) {
  if (!canReorder(itemId)) return null;
  const others = itemIds.filter((id) => id !== itemId);
  const targetIndex = others.slice(0, index).filter(canReorder).length;
  const sortable = itemIds.filter(canReorder);
  if (sameGroup)
    return getSharedTableDropOrder(
      sortable,
      sortable.indexOf(itemId),
      targetIndex,
    );
  const order = sortable.filter((id) => id !== itemId);
  order.splice(targetIndex, 0, itemId);
  return order;
}
/**
 * Where the dragged item would land, for a drop line: before the item that
 * would follow it, or after the target's last item. Undefined when the drop
 * changes nothing. Items `canReorder` refuses, such as subitems, stay in
 * place, so the line follows the reorderable items only.
 */
export function getBacklogDropMark(
  drag: Pick<Drag, "itemId" | "originKey" | "targetKey" | "index"> | null,
  targets: readonly BacklogDropTarget[],
  canReorder: (itemId: string) => boolean,
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
  const next = order[order.indexOf(drag.itemId) + 1];
  return next
    ? { itemId: next, edge: "before" }
    : { itemId: target.itemIds.at(-1)!, edge: "after" };
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
  canReorder: (itemId: string) => boolean;
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
