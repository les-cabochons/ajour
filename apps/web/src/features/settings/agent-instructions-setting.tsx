import { useEffect, useState } from "react";
import {
  INSTRUCTION_FILES,
  type InstructionAction,
  type InstructionFileState,
  type InstructionPreview,
} from "@ajour/shared/agent-instructions";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import "@/lib/desktop-bridge";

function diff(before: string, after: string) {
  const old = before.split(/\r?\n/);
  const next = after.split(/\r?\n/);
  let start = 0;
  while (
    start < old.length &&
    start < next.length &&
    old[start] === next[start]
  )
    start++;
  let endOld = old.length;
  let endNext = next.length;
  while (
    endOld > start &&
    endNext > start &&
    old[endOld - 1] === next[endNext - 1]
  ) {
    endOld--;
    endNext--;
  }
  return [
    ...old.slice(Math.max(0, start - 2), start).map((line) => ` ${line}`),
    ...old.slice(start, endOld).map((line) => `-${line}`),
    ...next.slice(start, endNext).map((line) => `+${line}`),
    ...old.slice(endOld, endOld + 2).map((line) => ` ${line}`),
  ].join("\n");
}

export function AgentInstructionsSetting() {
  const desktop = window.ajourDesktop;
  const available = !!(
    desktop?.listAgentInstructions &&
    desktop.previewAgentInstructions &&
    desktop.applyAgentInstructions
  );
  const [files, setFiles] = useState<InstructionFileState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    file: InstructionFileState;
    action: InstructionAction;
    preview: InstructionPreview;
  } | null>(null);
  useEffect(() => {
    if (!available) return;
    let active = true;
    void desktop!.listAgentInstructions!().then(
      (rows) => {
        if (active) setFiles(rows);
      },
      (cause: unknown) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [available, desktop]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  function preview(file: InstructionFileState, action: InstructionAction) {
    void run(async () =>
      setReview({
        file,
        action,
        preview: await desktop!.previewAgentInstructions!(file.id, action),
      }),
    );
  }
  const verb =
    review?.action === "add"
      ? "Add"
      : review?.action === "update"
        ? "Update"
        : "Remove";
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Agent instructions</h2>
      {!available ? (
        <p className="settings-section-desc">
          Agent instructions need the Ajour desktop app.
        </p>
      ) : (
        <>
          <p className="settings-section-desc">
            Ask agents to include the ticket number in their thread title.
            Review each change before saving it to your global instructions.
          </p>
          <AppPanel>
            {files.map((file) => {
              const label = INSTRUCTION_FILES.find(
                (entry) => entry.id === file.id,
              )!.label;
              return (
                <SettingRow
                  key={file.id}
                  label={label}
                  description={
                    <>
                      <span className="break-all">{file.path}</span>
                      <span className="block" role="status">
                        {file.error ??
                          (file.readOnly
                            ? "Read-only"
                            : file.status
                              ? file.status[0]!.toUpperCase() +
                                file.status.slice(1)
                              : "")}
                      </span>
                      {file.notice && (
                        <span className="block">{file.notice}</span>
                      )}
                    </>
                  }
                  stacked
                >
                  {!file.error && !file.readOnly && (
                    <div className="flex flex-wrap gap-2">
                      {(file.status === "missing file" ||
                        file.status === "no block") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Add to ${label}`}
                          onClick={() => preview(file, "add")}
                        >
                          Add
                        </Button>
                      )}
                      {file.status === "block outdated" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Update ${label}`}
                          onClick={() => preview(file, "update")}
                        >
                          Update
                        </Button>
                      )}
                      {(file.status === "block current" ||
                        file.status === "block outdated") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Remove from ${label}`}
                          onClick={() => preview(file, "remove")}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </SettingRow>
              );
            })}
          </AppPanel>
        </>
      )}
      {!review && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setReview(null);
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl" showCloseButton={!busy}>
          <DialogTitle>{verb} thread-naming instructions</DialogTitle>
          <DialogDescription className="break-all">
            {review?.file.path}
          </DialogDescription>
          {review?.preview.notice && (
            <p className="text-sm">{review.preview.notice}</p>
          )}
          <pre
            aria-label="Proposed diff"
            className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap"
          >
            {review ? diff(review.preview.before, review.preview.after) : ""}
          </pre>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!review) return;
                  await desktop!.applyAgentInstructions!(
                    review.file.id,
                    review.preview.token,
                  );
                  setReview(null);
                  setFiles(await desktop!.listAgentInstructions!());
                })
              }
            >
              Confirm {verb}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
