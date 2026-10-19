import {
  RiCloseLine,
  RiExpandDiagonalLine,
  RiExternalLinkLine,
  RiPencilLine,
  RiPlayLine,
  RiStopLine,
} from "@remixicon/react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { TooltipButton } from "@/components/tooltip-button";
import { Markdown } from "@/components/markdown";
import { SectionHeading } from "@/components/section-heading";
import { Figure, FigureRow, Value } from "@/components/ui/value";
import { getDirectChildWorkItems } from "@/domain/backlog/work-item-hierarchy";
import {
  getLocalProjectDisplayName,
  type LocalAppState,
  type LocalWorkItem,
} from "@/domain/local-state";
import type { BacklogItemActionId } from "@/domain/actions/object-actions";
import { getBacklogSurfaceActions } from "@/features/backlog/backlog-item-surface";
import { BacklogItemProperties } from "@/features/backlog/backlog-item-properties";
import {
  ESTIMATE_FIGURES,
  formatHours,
} from "@/features/backlog/backlog-estimates";
import {
  getVisitNotice,
  type BacklogItemReturnNotice,
} from "@/features/backlog/backlog-item-notice";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import { cn } from "@/lib/utils";

/**
 * The peek on the right of the backlog page: a smaller item page. It keeps the
 * page's header, estimate figures, properties, description and subitems, and lets
 * state, priority, project and task change in place. The row's context menu
 * and the item page carry the other actions. See "Peek" in docs/agents/ux-spec.md.
 */
export function BacklogPeek({
  item,
  state,
  now,
  returnNotice = null,
  onClose,
  onOpen,
  onAction,
  onSelect,
}: {
  item: LocalWorkItem;
  state: LocalAppState;
  now: number;
  /** Why the item came back, read before the peek cleared its Returned mark. */
  returnNotice?: BacklogItemReturnNotice | null;
  onClose: () => void;
  onOpen: () => void;
  onAction: (action: BacklogItemActionId) => void;
  onSelect: (item: LocalWorkItem) => void;
}) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector(
          '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [role="dialog"]',
        )
      ) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const iconData = useWorkItemIconData(state.projects);
  const project = state.projects.find((p) => p._id === item.projectId);
  const actions = getBacklogSurfaceActions(item, state, now);
  const startAction = actions.find((action) => action.id === "start-entry");
  const stopAction = actions.find((action) => action.id === "stop-entry");
  const children = getDirectChildWorkItems(item, state.workItems);
  const reference = parseWorkItemReference(item.sourceId) ?? item.sourceId;
  const notice = getVisitNotice(item, now, returnNotice);
  const progress =
    item.originalEstimateHours && item.completedEstimateHours !== undefined
      ? Math.min(1, item.completedEstimateHours / item.originalEstimateHours)
      : 0;
  return (
    <div className="backlog-peek" aria-label={`Peek ${item.title}`}>
      <div className="flex h-7 items-center justify-between gap-2">
        {reference ? (
          <Value tone="muted">#{reference}</Value>
        ) : (
          <span className="text-xs text-muted-foreground">Manual item</span>
        )}
        <div className="flex items-center">
          <TooltipButton
            label="Open page"
            render={<Button variant="ghost" size="icon" />}
            onClick={onOpen}
          >
            <RiExpandDiagonalLine className="size-4" />
          </TooltipButton>
          <TooltipButton
            label="Close peek"
            render={<Button variant="ghost" size="icon" />}
            onClick={onClose}
          >
            <RiCloseLine className="size-4" />
          </TooltipButton>
        </div>
      </div>
      <header className="flex min-w-0 items-start gap-2.5">
        <WorkItemIcon
          icon={resolveWorkItemIcon(item, iconData)}
          className="mt-1"
        />
        <div className="min-w-0">
          <h2 className="text-lg leading-6 font-semibold">{item.title}</h2>
          <div className="backlog-item-page-meta">
            {item.sourceWorkItemType ? (
              <Chip>{item.sourceWorkItemType}</Chip>
            ) : null}
            {project ? (
              <Chip color={project.color}>
                {getLocalProjectDisplayName(project)}
              </Chip>
            ) : null}
            {item.sourceUrl ? (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
              >
                Open in source
                <RiExternalLinkLine className="size-3" />
              </a>
            ) : null}
          </div>
        </div>
      </header>
      {notice ? (
        <p className="text-xs text-muted-foreground">{notice}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {stopAction ? (
          <Button variant="outline" onClick={() => onAction("stop-entry")}>
            <RiStopLine data-icon="inline-start" />
            Stop
          </Button>
        ) : item.status !== "archived" ? (
          <TooltipButton
            label={
              startAction?.disabledReason
                ? `Start entry. ${startAction.disabledReason}`
                : "Start entry"
            }
            aria-label="Start entry"
            aria-description={startAction?.disabledReason}
            aria-disabled={Boolean(startAction?.disabledReason)}
            render={
              <Button variant="outline" className="aria-disabled:opacity-50" />
            }
            onClick={() => {
              if (!startAction?.disabledReason) onAction("start-entry");
            }}
          >
            <RiPlayLine data-icon="inline-start" />
            Start entry
          </TooltipButton>
        ) : null}
        <Button
          variant="ghost"
          disabled={item.status === "archived"}
          onClick={() => onAction("edit")}
        >
          <RiPencilLine data-icon="inline-start" />
          Edit
        </Button>
      </div>
      <div className="flex flex-col gap-2.5">
        <FigureRow className="gap-x-6">
          {ESTIMATE_FIGURES.map((figure) => (
            <Figure key={figure.key} label={figure.label}>
              {formatHours(item[figure.key])}
            </Figure>
          ))}
        </FigureRow>
        <div
          className="backlog-item-progress"
          role="progressbar"
          aria-label="Completed over original estimate"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <section aria-label="Properties">
        <BacklogItemProperties item={item} state={state} />
      </section>
      {item.description ? (
        <section>
          <SectionHeading>Description</SectionHeading>
          <Markdown>{item.description}</Markdown>
        </section>
      ) : null}
      {children.length > 0 ? (
        <section>
          <SectionHeading
            trailing={`${children.filter((i) => i.status === "archived").length} of ${children.length} done`}
          >
            Subitems
          </SectionHeading>
          <div className="backlog-item-rows">
            {children.map((child) => (
              <button
                key={child._id}
                type="button"
                className="backlog-item-row text-left"
                onClick={() => onSelect(child)}
              >
                <WorkItemIcon icon={resolveWorkItemIcon(child, iconData)} />
                <span
                  className={cn(
                    "backlog-item-row-title",
                    child.status === "archived" && "text-muted-foreground",
                  )}
                >
                  {child.title}
                </span>
                <Value tone="muted" className="w-10 text-right">
                  {formatHours(child.remainingEstimateHours)}
                </Value>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
