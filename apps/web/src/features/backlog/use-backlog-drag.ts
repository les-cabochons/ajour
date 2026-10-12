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
interface Drag {
  itemId: string;
  originKey: string;
  targetKey: string | null;
  index: number;
  x: number;
  y: number;
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
  canReorder: boolean;
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
  }, [disabled, targetIdentity]);
  function pointerDown(
    itemId: string,
    originKey: string,
    event: PointerEvent<HTMLElement>,
  ) {
    if (
      disabled ||
      event.button !== 0 ||
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
        const ids = target.itemIds.filter((id) => id !== itemId);
        ids.splice(d.index, 0, itemId);
        const origin = target.itemIds.indexOf(itemId);
        const order = live.current.canReorder
          ? d.originKey === d.targetKey
            ? getSharedTableDropOrder(target.itemIds, origin, d.index)
            : ids
          : null;
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
    clickAllowed: () => performance.now() > suppress.current,
  };
}
