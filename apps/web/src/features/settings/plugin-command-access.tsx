import {
  displayCommandLine,
  displayCommandText,
} from "@ajour/shared/command-modes";
import { subscribeCommandAccess } from "@/lib/command-access-events";
import { useEffect, useState } from "react";
import type { z } from "zod";
import type {
  commandAccessSchema,
  CommandMode,
} from "@ajour/shared/command-modes";
import { SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { OptionSelect } from "@/components/ui/option-select";
import { getCommandAccess, updateCommandAccess } from "@/lib/app-api";
type Access = z.infer<typeof commandAccessSchema>;
export function CommandAccessControls({
  access,
  disabled,
  onChange,
}: {
  access: Access;
  disabled: boolean;
  onChange(change: { mode: CommandMode } | { remove: string }): void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SettingRow
        label="Undeclared commands"
        description="Choose when this plugin must ask before running a command."
      >
        <OptionSelect
          label="Command mode"
          value={access.mode}
          disabled={disabled}
          onChange={(mode) => onChange({ mode })}
          options={[
            { value: "always-ask", label: "Always ask" },
            { value: "auto", label: "Auto" },
            { value: "accept-everything", label: "Accept everything" },
          ]}
        />
      </SettingRow>
      <p role="note" className="text-sm text-muted-foreground">
        Process access is outside G1. G1 guarantees that plugins which start no
        process cannot obtain any credential, their own or another plugin's.
        Commands run as you and can reach every plugin's credentials in every
        mode.
      </p>
      {access.mode === "accept-everything" ? (
        <p role="alert" className="text-sm text-destructive">
          Accept everything runs undeclared commands without asking, even when
          marked risky. It removes the last per-command check. Commands run as
          you and can access every plugin's credentials.
        </p>
      ) : null}
      <h3 className="text-sm font-medium">Remembered approvals</h3>
      {access.approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No remembered approvals.
        </p>
      ) : (
        <ul>
          {access.approvals.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 border-b py-2"
            >
              <div className="min-w-0">
                <pre
                  dir="ltr"
                  className="text-xs break-all whitespace-pre-wrap"
                >
                  {[a.executable, ...a.argv].map((argument, index) => (
                    <span key={index}>
                      {index > 0 ? " " : null}
                      <bdi>{displayCommandLine([argument])}</bdi>
                    </span>
                  ))}
                </pre>
                <p className="text-xs text-muted-foreground">
                  Folder:{" "}
                  {displayCommandText(
                    a.folderName ??
                      (a.cwdFolder
                        ? "Repository folder unavailable"
                        : "System root"),
                  )}{" "}
                  {displayCommandText(a.folderPath ?? "Path unavailable")}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => onChange({ remove: a.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function PluginCommandAccess({ pluginId }: { pluginId: string }) {
  const [access, setAccess] = useState<Access>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setAccess(undefined);
    const refresh = () => {
      void getCommandAccess(pluginId).then(
        (value) => {
          if (current) {
            setAccess(value);
            setError(undefined);
          }
        },
        () => {
          if (current) setError("Command access could not be loaded.");
        },
      );
    };
    refresh();
    const unsubscribe = subscribeCommandAccess((changed) => {
      if (changed === pluginId) refresh();
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [pluginId]);
  const change = async (value: { mode: CommandMode } | { remove: string }) => {
    setBusy(true);
    setError(undefined);
    try {
      setAccess(await updateCommandAccess(pluginId, value));
    } catch {
      setError("Command access could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {access ? (
        <CommandAccessControls
          access={access}
          disabled={busy}
          onChange={(value) => {
            void change(value);
          }}
        />
      ) : null}
    </>
  );
}
