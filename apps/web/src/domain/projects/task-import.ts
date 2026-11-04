import { formatTaskName, normalizeTaskName } from "@ajour/shared/task-names";

export type ProjectTaskImportResult = {
  importedCount: number;
  /** Names the project had already, not counting waiting tasks they confirmed. */
  duplicateCount: number;
  /** Not known yet tasks the file named, which commit as their name now. */
  confirmedWaitingCount: number;
  blankCount: number;
  headerCount: number;
  importedNames: string[];
};

/** Shared with the terminal: see packages/shared/task-names.ts. */
export const formatTaskImportName = formatTaskName;
export const normalizeTaskImportName = normalizeTaskName;
