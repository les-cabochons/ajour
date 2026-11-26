import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RiMoreLine as More } from "@remixicon/react";
import {
  DECK_REGROUP_INSTRUCTION_MAX,
  type DeckGuide,
} from "@ajour/shared/deck";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  applyRegroupEvent,
  failRegroup,
  openRegroup,
  REGROUP_CLOSED,
  regroupGoing,
  regroupInstruction,
  startRegroup,
  type RegroupState,
} from "@/domain/deck/regroup";
import { watchAgentTurn } from "@/lib/agent-turns";
import {
  cancelAgentTurn,
  readDeckGuide,
  regroupDeckGuide,
  revertDeckGuide,
} from "@/lib/app-api";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { useDeckAsk } from "./deck-ask";
import { withConsent } from "./deck-ask-sessions";

/*
 * Regroup… and the guide's source label (#794). The label is plain text:
 * "Built from the code", or "Grouped by Claude Code" with a link back to
 * the built guide. Regroup… is a quiet action on the guide header, in the
 * "…" menu in the narrow view: it opens a short prefilled instruction
 * field, and sending it runs the agent's guide task. Once its turn ends,
 * the page reads the guide again and shows the agent's. The first regroup
 * in a repository asks for consent, as an ask does.
 */

/** What the guide header holds for a regroup, and the field under it. */
export function useRegroup(
  onGuide: (guide: DeckGuide | null, head: string) => void,
) {
  const context = useDeckAsk();
  const [state, setState] = useState<RegroupState>(REGROUP_CLOSED);
  const turnId = useRef<string | undefined>(undefined);
  const stopWatching = useRef<(() => void) | undefined>(undefined);
  /**
   * Counts the regroups, so a late answer of an earlier one is dropped, and
   * every answer once the header is gone, as a new head remounts it.
   */
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
      stopWatching.current?.();
    },
    [],
  );

  const target = context?.target;
  const guideRequest = useMemo(
    () =>
      target
        ? {
            repository: target.repository,
            number: target.number,
            head: target.head,
          }
        : undefined,
    [target],
  );

  const send = useCallback(
    async (instruction: string | undefined) => {
      if (!context || !target || !guideRequest) return;
      const mine = ++generation.current;
      const current = () => generation.current === mine;
      stopWatching.current?.();
      stopWatching.current = undefined;
      turnId.current = undefined;
      setState(startRegroup(instruction));
      const outcome = await withConsent(
        () =>
          regroupDeckGuide(target.pluginId, target.connectionId, {
            ...guideRequest,
            ...(instruction ? { instruction } : {}),
          }),
        {
          requestConsent: (request) => context.sessions.requestConsent(request),
          current,
        },
      );
      if (outcome.kind === "stale") return;
      if (outcome.kind === "declined") {
        setState(REGROUP_CLOSED);
        return;
      }
      if (outcome.kind === "failed") {
        setState((now) =>
          failRegroup(
            now,
            outcome.message ?? "Ajour couldn't regroup the guide.",
          ),
        );
        return;
      }
      const { turn } = outcome.value;
      turnId.current = turn.id;
      // Events already here replay at once, the end included.
      let ended = false;
      const stop = watchAgentTurn(turn.id, (event) => {
        if (!current()) return;
        setState((now) => applyRegroupEvent(now, event));
        if (event.type !== "ended") return;
        ended = true;
        stopWatching.current?.();
        stopWatching.current = undefined;
        turnId.current = undefined;
        // The guide may be saved even when the turn didn't end done.
        void readDeckGuide(
          target.pluginId,
          target.connectionId,
          guideRequest,
        ).then(
          ({ guide }) => {
            if (current()) onGuide(guide, guideRequest.head);
          },
          () => undefined,
        );
      });
      if (ended) stop();
      else stopWatching.current = stop;
    },
    [context, target, guideRequest, onGuide],
  );

  const revert = useCallback(async () => {
    if (!target || !guideRequest) return;
    const mine = ++generation.current;
    try {
      const { guide } = await revertDeckGuide(
        target.pluginId,
        target.connectionId,
        guideRequest,
      );
      if (generation.current === mine) onGuide(guide, guideRequest.head);
    } catch (error) {
      if (generation.current !== mine) return;
      setState(
        failRegroup(
          REGROUP_CLOSED,
          error instanceof Error
            ? error.message
            : "Ajour couldn't go back to the guide built from the code.",
        ),
      );
    }
  }, [target, guideRequest, onGuide]);

  return {
    /** False while the page asks nothing: the changes don't show. */
    available: context !== null,
    state,
    open: () => setState(openRegroup()),
    edit: (instruction: string) =>
      setState((now) =>
        now.kind === "composing" ? { ...now, instruction } : now,
      ),
    send: (instruction: string | undefined) => void send(instruction),
    stop: () => {
      if (turnId.current) {
        void cancelAgentTurn(turnId.current).catch(() => undefined);
      }
    },
    close: () => {
      generation.current += 1;
      setState(REGROUP_CLOSED);
    },
    revert: () => void revert(),
  };
}

export type Regroup = ReturnType<typeof useRegroup>;

/** "Built from the code", or "Grouped by Claude Code" with a link back to the built guide. */
export function GuideSource({
  guide,
  regroup,
}: {
  guide: DeckGuide;
  regroup: Regroup;
}) {
  if (guide.madeWith === "code") {
    return <span className="deck-guide-source">Built from the code</span>;
  }
  return (
    <span className="deck-guide-source">
      Grouped by {guide.provider.label} ·{" "}
      <button
        type="button"
        className="deck-guide-source-link"
        onClick={regroup.revert}
        disabled={regroupGoing(regroup.state)}
      >
        Built from the code
      </button>
    </span>
  );
}

/** Regroup…, quiet on the header, or in its "…" menu in the narrow view. */
export function RegroupAction({ regroup }: { regroup: Regroup }) {
  const narrow = useIsNarrowView();
  if (!regroup.available) return null;
  const busy = regroup.state.kind !== "closed";
  if (narrow) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More guide actions"
              className="deck-guide-more"
            />
          }
        >
          <More />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem disabled={busy} onClick={regroup.open}>
            Regroup…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="deck-guide-regroup"
      disabled={busy}
      onClick={regroup.open}
    >
      Regroup…
    </Button>
  );
}

/** Under the header: the instruction field, the regroup going on, or why it failed. */
export function RegroupPanel({ regroup }: { regroup: Regroup }) {
  const { state } = regroup;
  if (state.kind === "closed") return null;
  if (state.kind === "composing") {
    return <RegroupField regroup={regroup} instruction={state.instruction} />;
  }
  if (state.kind === "running") {
    return (
      <div className="deck-regroup">
        <p role="status" className="deck-regroup-status">
          {state.waiting
            ? "Waiting for the timesheet task to finish"
            : "Regrouping the guide…"}
        </p>
        <Button variant="ghost" size="sm" onClick={regroup.stop}>
          Stop
        </Button>
      </div>
    );
  }
  return (
    <div className="deck-regroup">
      <p role="alert" className="deck-regroup-status deck-ask-error">
        {state.message}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => regroup.send(state.instruction)}
      >
        Try again
      </Button>
      <Button variant="ghost" size="sm" onClick={regroup.close}>
        Dismiss
      </Button>
    </div>
  );
}

/**
 * The instruction, prefilled, focused and selected as it opens, so Enter
 * sends it as is and typing replaces it. Escape closes it, sending nothing.
 */
function RegroupField({
  regroup,
  instruction,
}: {
  regroup: Regroup;
  instruction: string;
}) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return (
    <form
      className="deck-regroup"
      aria-label="Regroup the guide"
      onSubmit={(event) => {
        event.preventDefault();
        regroup.send(regroupInstruction(instruction));
      }}
    >
      <Input
        ref={field}
        aria-label="Instruction"
        className="deck-regroup-field"
        value={instruction}
        maxLength={DECK_REGROUP_INSTRUCTION_MAX}
        onChange={(event) => regroup.edit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          regroup.close();
        }}
      />
      <Button type="submit" variant="ghost" size="sm">
        Regroup
      </Button>
    </form>
  );
}
