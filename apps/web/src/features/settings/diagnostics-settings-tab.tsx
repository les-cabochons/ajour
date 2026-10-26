import { useState } from "react";
import {
  RiDeleteBinLine as Trash2,
  RiFolderOpenLine as FolderOpen,
} from "@remixicon/react";
import { AppPanel, MessagePanel, SettingRow } from "@/components/app-surface";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  describeLogWarning,
  describeStorage,
  RETENTION_CHOICES,
  SIZE_LIMIT_CHOICES,
} from "./diagnostics-settings-model";
import { useLocalLogs } from "./use-local-logs";

/**
 * Diagnostics > Settings: the local log file's controls (ADR 0014). Each
 * control saves when it changes, through `logs.configure`, and shows what
 * main stored. There is no Save button.
 */
export function DiagnosticsSettingsTab() {
  const { status, error, busy, configure, deleteAll, openFolder } =
    useLocalLogs();
  const settings = status?.settings;
  const locked = !settings || busy;

  return (
    <div className="settings-sections">
      {status?.state === "warning" ? (
        <MessagePanel tone="warning" role="alert">
          {describeLogWarning(status.warning)}
        </MessagePanel>
      ) : null}
      {error ? (
        <MessagePanel tone="warning" role="alert">
          {error}
        </MessagePanel>
      ) : null}

      <section className="settings-section">
        <h2 className="settings-section-title">Local log file</h2>
        <p className="settings-section-desc">
          Ajour can record what it does to a file on this computer, to find out
          why something went wrong. Nothing is sent anywhere.
        </p>

        <AppPanel>
          <SettingRow
            label="Write events to a local file"
            labelFor="local-log-enabled"
            description="The files stay on this computer, in Ajour's data folder. Off until you turn it on."
          >
            <Switch
              id="local-log-enabled"
              checked={settings?.enabled === true}
              disabled={locked}
              onCheckedChange={(enabled) => void configure({ enabled })}
            />
          </SettingRow>
          <SettingRow
            label="Keep logs for"
            description="Days older than this are deleted."
          >
            <ToggleGroup
              aria-label="Keep logs for"
              variant="outline"
              value={settings ? [String(settings.retention_days)] : []}
              disabled={locked}
              onValueChange={(next) => {
                const choice = RETENTION_CHOICES.find(
                  ({ value }) => String(value) === next[0],
                );
                if (choice) void configure({ retention_days: choice.value });
              }}
            >
              {RETENTION_CHOICES.map(({ value, label }) => (
                <ToggleGroupItem key={value} value={String(value)}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            label="Size limit"
            description="When the files grow past this, the oldest days are deleted first."
          >
            <ToggleGroup
              aria-label="Size limit"
              variant="outline"
              value={settings ? [String(settings.size_limit_mb)] : []}
              disabled={locked}
              onValueChange={(next) => {
                const choice = SIZE_LIMIT_CHOICES.find(
                  ({ value }) => String(value) === next[0],
                );
                if (choice) void configure({ size_limit_mb: choice.value });
              }}
            >
              {SIZE_LIMIT_CHOICES.map(({ value, label }) => (
                <ToggleGroupItem key={value} value={String(value)}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            label="Include sensitive fields"
            labelFor="local-log-sensitive"
            description="Adds scrubbed error messages and time-entry durations to the file. Off by default."
          >
            <Switch
              id="local-log-sensitive"
              checked={settings?.include_sensitive === true}
              disabled={locked}
              onCheckedChange={(include_sensitive) =>
                void configure({ include_sensitive })
              }
            />
          </SettingRow>
          <SettingRow
            label="Storage"
            description={
              status ? (
                <span data-testid="local-log-storage">
                  {describeStorage(status)}
                </span>
              ) : (
                "Reading the log folder..."
              )
            }
          >
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => void openFolder()}
              >
                <FolderOpen data-icon="inline-start" />
                Open folder
              </Button>
              <DeleteAllLogsButton disabled={locked} onDelete={deleteAll} />
            </div>
          </SettingRow>
        </AppPanel>
      </section>
    </div>
  );
}

/** Delete all logs, after the person confirms: the files cannot be recovered. */
function DeleteAllLogsButton({
  disabled,
  onDelete,
}: {
  disabled: boolean;
  onDelete: () => void;
}) {
  // The action is a plain button, so the dialog closes here.
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="outline" disabled={disabled}>
            <Trash2 data-icon="inline-start" />
            Delete all logs
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete all logs?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes every log file from this computer. Your settings stay,
            and Ajour keeps writing new events if logging is on.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete all logs
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
