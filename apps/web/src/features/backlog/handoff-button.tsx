import { SplitButton } from "@/components/split-button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  getHandoffItemRefusal,
  getHandoffToolRefusal,
  pickHandoffTool,
  type HandoffTool,
} from "@/domain/handoffs/handoffs";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  detectHandoffToolsFor,
  useHandoffTools,
  useLastHandoffTool,
} from "@/lib/handoff-tools";
import {
  requestHandoff,
  useHandoffStarting,
} from "@/features/backlog/handoff-workflow";

/** A tool's own icon, from its plugin's manifest, drawn as an image. */
export function HandoffToolIcon({
  tool,
  className = "size-4",
}: {
  tool: Pick<HandoffTool, "iconSvg">;
  className?: string;
}) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      src={`data:image/svg+xml,${encodeURIComponent(tool.iconSvg)}`}
    />
  );
}

/**
 * The item page's Hand off to <tool> split button. The main half hands off
 * to the tool last used on this device; the arrow lists the other tools,
 * those this computer lacks disabled with why, then Review prompt…. Without
 * a handoff tool, as in the web build, it renders nothing.
 */
export function HandoffButton({ item }: { item: LocalWorkItem }) {
  const tools = useHandoffTools(item.projectId);
  const lastKey = useLastHandoffTool();
  const busy = useHandoffStarting(item._id);
  if (!tools.length) return null;
  const tool = pickHandoffTool(tools, lastKey) ?? tools[0]!;
  const itemRefusal = getHandoffItemRefusal(item);
  const refusal = itemRefusal ?? getHandoffToolRefusal(tool);
  const others = tools.filter((candidate) => candidate.key !== tool.key);
  return (
    <SplitButton
      variant="outline"
      onClick={() => requestHandoff({ itemId: item._id, toolKey: tool.key })}
      disabled={Boolean(refusal) || busy}
      title={refusal}
      menuLabel="Other ways to hand off"
      menuDisabled={busy}
      menuClassName="min-w-64"
      menu={
        <>
          {others.map((other) => {
            const reason = itemRefusal ?? getHandoffToolRefusal(other);
            return (
              <DropdownMenuItem
                key={other.key}
                disabled={Boolean(reason)}
                aria-description={reason}
                className="flex-col items-stretch gap-0"
                onClick={() =>
                  requestHandoff({ itemId: item._id, toolKey: other.key })
                }
              >
                <span className="flex items-center gap-2">
                  <HandoffToolIcon tool={other} />
                  Hand off to {other.label}
                </span>
                {reason ? (
                  <span className="pl-6 text-xs font-normal text-muted-foreground">
                    {reason}
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
          {others.length ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            disabled={Boolean(refusal)}
            aria-description={refusal}
            className="flex-col items-stretch gap-0"
            onClick={() =>
              requestHandoff({
                itemId: item._id,
                toolKey: tool.key,
                review: true,
              })
            }
          >
            <span>Review prompt…</span>
            <span className="text-xs font-normal text-muted-foreground">
              {refusal ??
                `Edit the prompt, folder and branch for ${tool.label}`}
            </span>
          </DropdownMenuItem>
        </>
      }
      onMenuOpenChange={(open) => {
        // A tool installed since the page opened shows up in the menu.
        if (open && item.projectId) void detectHandoffToolsFor(item.projectId);
      }}
    >
      <HandoffToolIcon tool={tool} />
      Hand off to {tool.label}
    </SplitButton>
  );
}
