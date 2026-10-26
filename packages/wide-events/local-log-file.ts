// Entry point for the desktop main process only: the local log file, its
// day files, retention and warning state (ADR 0014). It needs Node's fs.
export { createLocalLogFile } from "./lib/local-log-file.ts";
export type {
  LocalLogDeletion,
  LocalLogFile,
  LocalLogFileOptions,
  LocalLogFileSystem,
  LocalLogRetentionDays,
  LocalLogSettings,
  LocalLogSizeLimitMb,
  LocalLogState,
  LocalLogStatus,
  LocalLogSweep,
  LocalLogWarning,
} from "./lib/local-log-file.ts";
