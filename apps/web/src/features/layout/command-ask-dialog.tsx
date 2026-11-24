import { connectMcpBridge } from "@/lib/mcp-bridge";
import {
  displayCommandLine,
  displayCommandText,
} from "@ajour/shared/command-modes";
import { commandAccessChanged } from "@/lib/command-access-events";
import { useEffect, useState } from "react";
import { commandAskSchema, type CommandAsk } from "@ajour/shared/command-modes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { answerCommand } from "@/lib/app-api";
export function CommandAskDialog({
  ask,
  disabled,
  onAnswer,
  error,
}: {
  ask: CommandAsk;
  disabled: boolean;
  error?: string;
  onAnswer(answer: "once" | "always" | "deny" | "deny-all"): void;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const timer = setTimeout(() => setReady(true), 600);
    return () => clearTimeout(timer);
  }, [ask.id]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !disabled) onAnswer("deny");
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {displayCommandText(ask.pluginName)} wants to run a command
          </DialogTitle>
          <DialogDescription>
            Commands run as you, outside the sandbox. This request is denied
            after two minutes.
          </DialogDescription>
        </DialogHeader>
        {/* Left to right, each argument isolated, so right-to-left text can't
            visually reorder arguments. */}
        <pre
          aria-label="Exact command arguments"
          dir="ltr"
          className="overflow-auto text-xs break-all whitespace-pre-wrap"
        >
          {[ask.executable, ...ask.argv].map((argument, index) => (
            <span key={index}>
              {index > 0 ? " " : null}
              <bdi>{displayCommandLine([argument])}</bdi>
            </span>
          ))}
        </pre>
        <p>
          Plugin: {ask.pluginId}, {ask.signed ? "Signed" : "Unsigned"}
        </p>
        <p>
          Executable:{" "}
          {displayCommandText(ask.resolvedExecutable ?? ask.executable)}
        </p>
        <p>Folder: {displayCommandText(ask.folderName)}</p>
        <p>{displayCommandText(ask.folderPath ?? "Path unavailable")}</p>
        {error ? <p role="alert">{error}</p> : null}
        {ask.reason ? (
          <p
            className={ask.risky ? "text-destructive" : "text-muted-foreground"}
          >
            {ask.reason}
          </p>
        ) : null}
        {/* An approval is kept for a repository folder and covers its
            worktrees (#860), wherever the command asked from: in a worktree
            the ask names that folder apart. */}
        <p className="text-xs text-muted-foreground">
          {ask.cwdFolder
            ? `Always remembers this executable and every argument for ${displayCommandText(ask.scopeFolderName ?? ask.folderName)} and its worktrees. An updated package or lost signature clears it.`
            : "Always remembers only this executable, every argument, and this folder id. An updated package or lost signature clears it."}
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            autoFocus
            disabled={disabled}
            onClick={() => onAnswer("deny")}
          >
            Deny
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onAnswer("deny-all")}
          >
            Deny all from this plugin
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !ready}
            onClick={() => onAnswer("always")}
          >
            Always
          </Button>
          <Button
            disabled={disabled || !ready}
            onClick={() => onAnswer("once")}
          >
            Allow once
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function CommandAskHost() {
  const [ask, setAsk] = useState<CommandAsk | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    return connectMcpBridge(
      {
        onStatus: (status) => {
          if (status === "disconnected" || status === "reconnecting")
            setAsk(null);
        },
        runToolCall: () => ({ requestId: "", ok: false, error: "Unsupported" }),
        onStream: (stream) => {
          stream.addEventListener("command-ask", (event) => {
            try {
              const raw: unknown = JSON.parse(
                (event as MessageEvent<string>).data,
              );
              const parsed = commandAskSchema.nullable().safeParse(raw);
              if (parsed.success) {
                setAsk(parsed.data);
                setBusy(false);
                setError(undefined);
              }
            } catch {
              setAsk(null);
            }
          });
          stream.addEventListener("command-access", (event) => {
            try {
              const pluginId: unknown = JSON.parse(
                (event as MessageEvent<string>).data,
              );
              if (typeof pluginId === "string") commandAccessChanged(pluginId);
            } catch {
              /* Ignore malformed notifications. */
            }
          });
        },
      },
      "/api/process/bridge",
    );
  }, []);
  useEffect(() => {
    if (!ask) return;
    const timer = setTimeout(
      () => setAsk(null),
      Math.max(0, ask.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [ask]);
  const answer = async (value: "once" | "always" | "deny" | "deny-all") => {
    if (!ask) return;
    setBusy(true);
    try {
      await answerCommand(ask.id, value);
    } catch {
      setError("The answer could not be sent. The command remains blocked.");
      setBusy(false);
    }
  };
  return (
    <>
      {ask ? (
        <CommandAskDialog
          key={ask.id}
          ask={ask}
          disabled={busy}
          error={error}
          onAnswer={(value) => {
            void answer(value);
          }}
        />
      ) : null}
    </>
  );
}
