import type {
  LocalLogRetentionDays,
  LocalLogSizeLimitMb,
  LocalLogStatus,
} from "@ajour/wide-events/local-log-file.ts";

/** The choices for how long logs are kept, as Settings › Diagnostics offers them. */
export const RETENTION_CHOICES: ReadonlyArray<{
  value: LocalLogRetentionDays;
  label: string;
}> = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

/** The choices for the folder's size limit. */
export const SIZE_LIMIT_CHOICES: ReadonlyArray<{
  value: LocalLogSizeLimitMb;
  label: string;
}> = [
  { value: 100, label: "100 MB" },
  { value: 250, label: "250 MB" },
  { value: 1000, label: "1 GB" },
];

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** A byte count in the largest unit that keeps it above one, with one decimal from KB up. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0
    ? `${Math.round(value)} B`
    : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** What the folder holds: "1.2 MB in 4 files, oldest 2026-10-20", or zero. */
export function describeStorage(
  status: Pick<LocalLogStatus, "storage_bytes" | "file_count" | "oldest_day">,
): string {
  const files = `${status.file_count} ${status.file_count === 1 ? "file" : "files"}`;
  const used = `${formatBytes(status.storage_bytes)} in ${files}`;
  return status.oldest_day ? `${used}, oldest ${status.oldest_day}` : used;
}

/**
 * Why writing stopped and how to resume it, in plain words. Any save of the
 * settings clears the warning (the log file's `configure`), so turning the
 * switch off and on again resumes; so does the next launch.
 */
export function describeLogWarning(reason: LocalLogStatus["warning"]): string {
  const cause =
    reason === "disk_full"
      ? "The disk is full."
      : reason === "no_permission"
        ? "Ajour isn't allowed to write in the log folder."
        : "Writing to the log file failed.";
  return `${cause} Ajour stopped writing events to the file. Your work isn't affected. To resume, fix the cause, then turn Write events to a local file off and on again, or restart Ajour.`;
}
