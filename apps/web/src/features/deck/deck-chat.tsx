import { createContext, useContext, useEffect, useRef, useState } from "react";
import { RiCloseLine } from "@remixicon/react";
import { DECK_QUESTION_MAX, type DeckAskAnchor } from "@ajour/shared/deck";
import { Markdown } from "@/components/markdown";
import { SidePanel } from "@/components/side-panel";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { askText } from "@/domain/deck/ask";
import { chatGoing, chatHeader, type ChatEntry } from "@/domain/deck/chat";
import { useAgentRunner } from "@/lib/agent-runner";
import { getDeckClones } from "@/lib/app-api";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import {
  useChatState,
  type DeckChatSession,
  type DeckChatTarget,
} from "./deck-chat-session";

/*
 * Deck's chat (#796), the fallback for what the asks don't cover. **Chat**
 * in the top bar, or A, opens it: a 360px panel docked on the right of the
 * review page, or a full-height sheet in the narrow view. Its header is the
 * one place that names the agent and what it reads. Continue in chat on an
 * answer carries the answer's anchor into the composer as a chip. Each
 * write the chat makes in the user's name shows as one action line, with
 * its link, and Delete for what it posted (ADR 0024).
 */

/** What an answer's Continue in chat reaches, while the review page shows. */
interface DeckChatContextValue {
  continueInChat(anchor: DeckAskAnchor, label: string): void;
}

export const DeckChatContext = createContext<DeckChatContextValue | null>(null);

/** Continue in chat, or undefined outside the review page. */
export function useContinueInChat() {
  return useContext(DeckChatContext)?.continueInChat;
}

/** Whether the user chose a local clone for the repository, read once as the chat opens. */
function useCloneChosen(target: DeckChatTarget) {
  const [chosen, setChosen] = useState(false);
  const { pluginId, connectionId, repository, clone } = target;
  useEffect(() => {
    if (!clone) return;
    let live = true;
    getDeckClones()
      .then(({ clones }) => {
        if (!live) return;
        setChosen(
          clones.some(
            (entry) =>
              entry.pluginId === pluginId &&
              entry.connectionId === connectionId &&
              entry.repository.toLowerCase() === repository.toLowerCase(),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pluginId, connectionId, repository, clone]);
  return chosen;
}

/** The agent Settings › Agents picks, as the header names it. */
function useProviderLabel() {
  const runner = useAgentRunner();
  if (runner.kind !== "ready") return undefined;
  const { cli } = runner.overview.settings;
  return runner.overview.clis.find((entry) => entry.id === cli)?.label;
}

export interface DeckChatPanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  session: DeckChatSession;
  target: DeckChatTarget;
  /** The code host's name, for a Delete it can't make. */
  pluginName: string;
  /** Scrolls the review page to a line an action line names. */
  onShow(at: { path: string; side: "base" | "head"; line: number }): void;
  /** Scrolls the review page to the guide, after a regroup. */
  onShowGuide(): void;
  /** The pull request on the code host, where a write without a link of its own shows. */
  pullRequestUrl: string;
}

/** The chat panel, or the full-height sheet in the narrow view. Nothing mounts while it's closed. */
export function DeckChatPanel(props: DeckChatPanelProps) {
  const { open, onOpenChange } = props;
  const narrow = useIsNarrowView();
  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          // Full width and full height, over the Sheet's 3/4 default.
          className="deck-chat-sheet data-[side=right]:w-full data-[side=right]:sm:max-w-none"
          showCloseButton={false}
        >
          <ChatBody {...props} titled={false} />
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <SidePanel
      contentKey="deck-chat"
      widthKey="deck"
      aria-label="Chat"
      className="deck-chat-panel"
      contentClassName="deck-chat-scroll"
      onKeyDown={(event) => {
        if (event.key === "Escape") onOpenChange(false);
      }}
    >
      <ChatBody {...props} titled />
    </SidePanel>
  );
}

function ChatBody({
  onOpenChange,
  session,
  target,
  pluginName,
  onShow,
  onShowGuide,
  pullRequestUrl,
  titled,
}: DeckChatPanelProps & { titled: boolean }) {
  const state = useChatState(session);
  const provider = useProviderLabel();
  const chosen = useCloneChosen(target);
  const header = chatHeader({
    number: target.number,
    ...(provider ? { provider } : {}),
    ...(session.clone
      ? { clone: session.clone }
      : chosen
        ? { clone: "chosen" as const }
        : {}),
  });
  const going = chatGoing(state);
  const field = useRef<HTMLTextAreaElement>(null);
  // The composer takes the focus as the chat opens, and when a chip comes in.
  useEffect(() => {
    field.current?.focus();
  }, [state.chip]);
  const send = () => void session.send(target);
  const Title = titled ? "h2" : SheetTitle;
  return (
    <div className="deck-chat">
      <SheetHeaderOrDiv titled={titled}>
        <div className="deck-chat-header">
          <div className="min-w-0">
            <Title className="text-base font-semibold">Chat</Title>
            <p className="deck-chat-reads">{header.text}</p>
          </div>
          <TooltipButton
            label="Close chat"
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
              />
            }
          >
            <RiCloseLine />
          </TooltipButton>
        </div>
        {header.cloneReason ? (
          <p className="deck-chat-reads">{header.cloneReason}</p>
        ) : null}
      </SheetHeaderOrDiv>
      <ol className="deck-chat-log" role="log" aria-label="Messages">
        {state.entries.length === 0 ? (
          <li className="deck-chat-empty">
            Ask about this pull request, or ask the chat to comment, reply,
            resolve or review for you.
          </li>
        ) : (
          state.entries.map((entry) => (
            <ChatLine
              key={entryKey(entry)}
              entry={entry}
              onDelete={(action) =>
                void session.delete(action, target, pluginName)
              }
              onShow={onShow}
              onShowGuide={onShowGuide}
              pullRequestUrl={pullRequestUrl}
            />
          ))
        )}
      </ol>
      <form
        className="deck-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {state.chip ? (
          <Chip className="deck-chat-chip">
            {state.chip.label}
            <button
              type="button"
              className="deck-chat-chip-remove"
              aria-label={`Remove ${state.chip.label}`}
              onClick={() => session.removeChip()}
            >
              <RiCloseLine aria-hidden="true" />
            </button>
          </Chip>
        ) : null}
        <Textarea
          ref={field}
          aria-label="Message"
          placeholder="Message…"
          rows={2}
          value={state.draft}
          maxLength={DECK_QUESTION_MAX}
          onChange={(event) => session.editDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="deck-chat-composer-actions">
          {going ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => session.stop()}
            >
              Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!state.draft.trim()}>
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function SheetHeaderOrDiv({
  titled,
  children,
}: {
  titled: boolean;
  children: React.ReactNode;
}) {
  return titled ? (
    <header>{children}</header>
  ) : (
    <SheetHeader className="p-0">{children}</SheetHeader>
  );
}

const entryKey = (entry: ChatEntry) =>
  entry.kind === "action" ? `action:${entry.action.id}` : entry.id;

function ChatLine({
  entry,
  onDelete,
  onShow,
  onShowGuide,
  pullRequestUrl,
}: {
  entry: ChatEntry;
  onDelete: (action: Extract<ChatEntry, { kind: "action" }>["action"]) => void;
} & Pick<DeckChatPanelProps, "onShow" | "onShowGuide" | "pullRequestUrl">) {
  if (entry.kind === "message") {
    return (
      <li className="deck-chat-message">
        {entry.chip ? (
          <Chip className="deck-chat-chip">{entry.chip.label}</Chip>
        ) : null}
        <p>{entry.text}</p>
      </li>
    );
  }
  if (entry.kind === "action") {
    const { action, deletion } = entry;
    return (
      <li className="deck-chat-action">
        <span className={deletion === "deleted" ? "line-through" : undefined}>
          {action.text}
        </span>
        {action.url ? (
          <a href={action.url} target="_blank" rel="noreferrer">
            Open
          </a>
        ) : action.at ? (
          <button
            type="button"
            className="deck-chat-link"
            onClick={() => onShow(action.at!)}
          >
            Show
          </button>
        ) : action.kind === "regroup" ? (
          <button
            type="button"
            className="deck-chat-link"
            onClick={onShowGuide}
          >
            Show
          </button>
        ) : (
          // Every line has a link: a write the code host gave no address
          // for shows on the pull request.
          <a href={pullRequestUrl} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
        {action.posted && deletion !== "deleted" ? (
          <button
            type="button"
            className="deck-chat-link"
            disabled={deletion === "deleting"}
            onClick={() => onDelete(action)}
          >
            {deletion === "deleting" ? "Deleting…" : "Delete"}
          </button>
        ) : null}
        {deletion === "deleted" ? (
          <span className="deck-chat-note">Deleted</span>
        ) : null}
        {typeof deletion === "object" ? (
          <span role="alert" className="deck-chat-note deck-ask-error">
            {deletion.failed}
          </span>
        ) : null}
      </li>
    );
  }
  const { state } = entry;
  const text = askText(state);
  return (
    <li className="deck-chat-reply">
      {state.kind === "asking" ? (
        <p role="status" className="deck-ask-placeholder">
          Thinking…
        </p>
      ) : state.kind === "waiting" ? (
        <p role="status" className="deck-ask-placeholder">
          Waiting for the timesheet task to finish
        </p>
      ) : null}
      {text ? <Markdown className="deck-ask-text">{text}</Markdown> : null}
      {state.kind === "stopped" ? (
        <p className="deck-ask-footer">Stopped.</p>
      ) : state.kind === "failed" ? (
        <p role="alert" className="deck-ask-footer deck-ask-error">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
