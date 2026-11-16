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
import { answerCommand, appApiUrl } from "@/lib/app-api";
export function CommandAskDialog({
  ask,
  disabled,
  onAnswer,
}: {
  ask: CommandAsk;
  disabled: boolean;
  onAnswer(answer: "once" | "always" | "deny"): void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !disabled) onAnswer("deny");
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{ask.pluginName} wants to run a command</DialogTitle>
          <DialogDescription>
            Commands run as you, outside the sandbox. This request is denied
            after two minutes.
          </DialogDescription>
        </DialogHeader>
        <pre
          aria-label="Exact command arguments"
          className="overflow-auto text-xs break-all whitespace-pre-wrap"
        >
          {JSON.stringify([ask.executable, ...ask.argv], null, 2)}
        </pre>
        <p>Folder: {ask.folderName}</p>
        {ask.reason ? (
          <p
            className={ask.risky ? "text-destructive" : "text-muted-foreground"}
          >
            {ask.reason}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Always remembers only this executable, every argument, and this folder
          id. An updated package or lost signature clears it.
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onAnswer("deny")}
          >
            Deny
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onAnswer("always")}
          >
            Always
          </Button>
          <Button disabled={disabled} onClick={() => onAnswer("once")}>
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
    const stream = new EventSource(appApiUrl("/api/process/bridge"));
    stream.addEventListener("command-ask", (event) => {
      try {
        const raw: unknown = JSON.parse((event as MessageEvent<string>).data);
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
    stream.onerror = () => setAsk(null);
    return () => stream.close();
  }, []);
  useEffect(() => {
    if (!ask) return;
    const timer = setTimeout(
      () => setAsk(null),
      Math.max(0, ask.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [ask]);
  const answer = async (value: "once" | "always" | "deny") => {
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
          onAnswer={(value) => {
            void answer(value);
          }}
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
