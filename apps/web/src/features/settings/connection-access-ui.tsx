import { Link } from "@tanstack/react-router";
import {
  connectionAccessAllows,
  EDIT_WORK_ITEMS_ACCESS,
} from "@ajour/shared/connection-access";
import type {
  ConnectionAccessChoiceSummary,
  PluginConnectionSummary,
  PluginOverviewGroup,
} from "@ajour/shared";
import { MessagePanel } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";

/*
 * Connection access (#395): the Access group of a connection form, the
 * row's badge and its "N changes held" line. Only a plugin with access
 * choices, such as Azure DevOps, shows them.
 */

const changes = (count: number) =>
  `${count} ${count === 1 ? "change" : "changes"}`;

/** Whether the connection may edit work items in its source. */
export function connectionEdits(
  group: Pick<PluginOverviewGroup, "connectionAccess">,
  connection: Pick<PluginConnectionSummary, "access">,
) {
  return connectionAccessAllows(group, connection, "writeSettle");
}

/** The row's badge: what the connection may do in its source. */
export function ConnectionAccessBadge({
  group,
  connection,
}: {
  group: PluginOverviewGroup;
  connection: PluginConnectionSummary;
}) {
  if (!group.connectionAccess?.length) return null;
  return (
    <Badge variant="outline">
      {connectionEdits(group, connection)
        ? "Edits work items"
        : "Reads backlog"}
    </Badge>
  );
}

/**
 * The row's line for the changes held on this computer: while editing is
 * off, how to send them; once it's on, where to review them.
 */
export function HeldEditsLine({
  count,
  editing,
  connectionId,
}: {
  count: number;
  editing: boolean;
  connectionId: string;
}) {
  if (count === 0) return null;
  return (
    <p className="text-xs text-muted-foreground" data-held-count={count}>
      {changes(count)} held.{" "}
      {editing ? (
        <Link
          to="/settings/sync-review"
          search={{ held: connectionId } as never}
          className="text-primary underline-offset-2 hover:underline"
        >
          Review them in Sync review
        </Link>
      ) : (
        "Turn on editing to review and send them."
      )}
    </p>
  );
}

/**
 * The Access group of a connection form: one checkbox per choice, each
 * naming the token scope it needs. A choice that is always on is checked
 * and can't be turned off. Ajour enforces what is chosen here, whatever the
 * token allows.
 */
export function ConnectionAccessGroup({
  choices,
  access,
  heldCount,
  disabled,
  onChange,
}: {
  choices: readonly ConnectionAccessChoiceSummary[];
  /** The choices turned on, those always on left out. */
  access: readonly string[];
  heldCount: number;
  disabled: boolean;
  onChange: (choiceId: string, on: boolean) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <FieldSet className="gap-3 desktop:col-span-2">
      <FieldLegend variant="label" className="mb-0 text-foreground">
        Access
      </FieldLegend>
      <p className="-mt-2 text-xs text-muted-foreground">
        Ajour blocks anything not chosen here, even when the token allows more.
      </p>
      {choices.map((choice) => {
        const checked = choice.always || access.includes(choice.id);
        const description = [
          choice.description,
          choice.always ? "Always on." : undefined,
          choice.tokenScope
            ? `The token needs ${choice.tokenScope}.`
            : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={choice.id} className="flex flex-col gap-3">
            <Field orientation="horizontal">
              <Checkbox
                id={`access-${choice.id}`}
                aria-label={choice.label}
                checked={checked}
                disabled={disabled || choice.always}
                onCheckedChange={(next) => onChange(choice.id, next === true)}
                className="mt-0.5"
              />
              <FieldContent>
                <FieldLabel htmlFor={`access-${choice.id}`}>
                  {choice.label}
                </FieldLabel>
                {description ? (
                  <FieldDescription>{description}</FieldDescription>
                ) : null}
              </FieldContent>
            </Field>
            {choice.id === EDIT_WORK_ITEMS_ACCESS && heldCount > 0 ? (
              <MessagePanel>
                {changes(heldCount)} made while editing was off{" "}
                {heldCount === 1 ? "is" : "are"} held on this computer. When you
                turn editing on, you review them in Sync review before anything
                is sent.
              </MessagePanel>
            ) : null}
          </div>
        );
      })}
    </FieldSet>
  );
}
