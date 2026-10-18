import { useEffect, useMemo, useState } from "react";
import { RiCheckboxBlankCircleLine as TaskIcon } from "@remixicon/react";
import {
  DEFAULT_BACKLOG_TASK_ICON_DISPLAY_MODE,
  backlogTaskIconDisplayModes,
  type BacklogTaskIconDisplayMode,
} from "@ajour/shared";
import type { LocalProject, LocalWorkItem } from "@/domain/local-state";
import { getPluginsOverview } from "@/lib/app-api";
import { ProjectIcon } from "@/lib/project-icons";
import { useResolvedTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";

type ResolvedWorkItemIcon =
  | { kind: "project"; project: LocalProject }
  | { kind: "plugin"; svg: string; currentColor: string }
  | { kind: "default" };

type WorkItemIconData = {
  projectsById: Map<string, LocalProject>;
  pluginIconsBySource: Record<string, string>;
  pluginIconCurrentColor: string;
  backlogTaskIconModesByConnectionId: Record<
    string,
    BacklogTaskIconDisplayMode
  >;
};

function normalizeBacklogTaskIconDisplayMode(
  value: unknown,
): BacklogTaskIconDisplayMode {
  return backlogTaskIconDisplayModes.includes(
    value as BacklogTaskIconDisplayMode,
  )
    ? (value as BacklogTaskIconDisplayMode)
    : DEFAULT_BACKLOG_TASK_ICON_DISPLAY_MODE;
}

export function useWorkItemIconData(
  projects: LocalProject[],
): WorkItemIconData {
  const resolvedTheme = useResolvedTheme();
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project._id, project] as const)),
    [projects],
  );
  const [pluginIconsBySource, setPluginIconsBySource] = useState<
    Record<string, string>
  >({});
  const [backlogTaskIconModesByConnectionId, setBacklogTaskIconModes] =
    useState<Record<string, BacklogTaskIconDisplayMode>>({});

  useEffect(() => {
    void getPluginsOverview()
      .then((overview) => {
        setPluginIconsBySource(
          Object.fromEntries(
            overview.plugins.map(
              (plugin) => [plugin.id, plugin.iconSvg] as const,
            ),
          ),
        );
        setBacklogTaskIconModes(
          Object.fromEntries(
            overview.connectionGroups.flatMap((group) =>
              group.connections.map((connection) => [
                connection.id,
                normalizeBacklogTaskIconDisplayMode(
                  connection.editableValues.taskIconDisplayMode,
                ),
              ]),
            ),
          ),
        );
      })
      .catch(() => undefined);
  }, []);

  return useMemo(
    () => ({
      projectsById,
      pluginIconsBySource,
      pluginIconCurrentColor: resolvedTheme === "dark" ? "#fafafa" : "#171717",
      backlogTaskIconModesByConnectionId,
    }),
    [
      projectsById,
      pluginIconsBySource,
      resolvedTheme,
      backlogTaskIconModesByConnectionId,
    ],
  );
}

const FIXED_SVG_PAINT_ATTRIBUTE =
  /\b(?:color|fill|stroke|stop-color|flood-color|lighting-color)\s*=\s*["']\s*(?!(?:currentColor|none|transparent)\s*["'])[^"']+/i;
const FIXED_SVG_PAINT_STYLE =
  /\b(?:color|fill|stroke|stop-color|flood-color|lighting-color)\s*:\s*(?!(?:currentColor|none|transparent)(?:\s*!important)?\s*(?:[;}"']|$))[^;}"']+/i;

export function resolvePluginIconPaint(svg: string, currentColor: string) {
  const usesCurrentColor = /\bcurrentColor\b/i.test(svg);
  const hasFixedPaint =
    FIXED_SVG_PAINT_ATTRIBUTE.test(svg) || FIXED_SVG_PAINT_STYLE.test(svg);

  return {
    usesMask: usesCurrentColor && !hasFixedPaint,
    svg:
      usesCurrentColor && hasFixedPaint
        ? svg.replaceAll(/currentColor/gi, currentColor)
        : svg,
  };
}

export function resolveWorkItemIcon(
  workItem: LocalWorkItem,
  iconData: WorkItemIconData,
): ResolvedWorkItemIcon {
  const project = workItem.projectId
    ? iconData.projectsById.get(workItem.projectId)
    : undefined;
  const isSyncedItem = workItem.source !== "manual";

  if (!isSyncedItem) {
    return project ? { kind: "project", project } : { kind: "default" };
  }

  const pluginIcon = iconData.pluginIconsBySource[workItem.source];
  const backlogTaskIconMode = normalizeBacklogTaskIconDisplayMode(
    workItem.sourceConnectionId
      ? iconData.backlogTaskIconModesByConnectionId[workItem.sourceConnectionId]
      : undefined,
  );

  if (backlogTaskIconMode === "always" && pluginIcon) {
    return {
      kind: "plugin",
      svg: pluginIcon,
      currentColor: iconData.pluginIconCurrentColor,
    };
  }

  if (project) {
    return { kind: "project", project };
  }

  if (backlogTaskIconMode === "fallback" && pluginIcon) {
    return {
      kind: "plugin",
      svg: pluginIcon,
      currentColor: iconData.pluginIconCurrentColor,
    };
  }

  return { kind: "default" };
}

export function WorkItemIcon({
  icon,
  className,
}: {
  icon: ResolvedWorkItemIcon;
  className?: string;
}) {
  if (icon.kind === "plugin") {
    const paint = resolvePluginIconPaint(icon.svg, icon.currentColor);
    const iconSource = `data:image/svg+xml,${encodeURIComponent(paint.svg)}`;
    return (
      <span
        className={cn(
          "backlog-task-source-icon inline-flex size-4 items-center justify-center [&>img]:size-4",
          className,
        )}
        aria-hidden="true"
      >
        {paint.usesMask ? (
          <span
            className="size-4 bg-current"
            style={{
              maskImage: `url("${iconSource}")`,
              maskPosition: "center",
              maskRepeat: "no-repeat",
              maskSize: "contain",
              WebkitMaskImage: `url("${iconSource}")`,
              WebkitMaskPosition: "center",
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskSize: "contain",
            }}
          />
        ) : (
          <img src={iconSource} alt="" />
        )}
      </span>
    );
  }

  if (icon.kind === "project") {
    return (
      <ProjectIcon
        icon={icon.project.icon}
        color={icon.project.color}
        className={cn("backlog-task-source-icon", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "backlog-task-source-icon backlog-task-default-icon inline-flex items-center justify-center",
        className,
      )}
      style={{ color: "var(--text-tertiary)" }}
    >
      <TaskIcon />
    </span>
  );
}
