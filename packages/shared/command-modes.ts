import { z } from "zod";
import { executableNameSchema } from "./plugin-api-4.ts";
export const commandModeSchema = z.enum([
  "always-ask",
  "auto",
  "accept-everything",
]);
export type CommandMode = z.infer<typeof commandModeSchema>;
export const undeclaredCommandSchema = z
  .object({
    executable: executableNameSchema,
    argv: z
      .array(
        z
          .string()
          .max(32767)
          .refine(
            (v) =>
              !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Cs}\p{Cn}]/u.test(
                v,
              ),
          ),
      )
      .max(100),
    cwdFolder: z.string().min(1).max(200).optional(),
  })
  .strict();
export type UndeclaredCommand = z.infer<typeof undeclaredCommandSchema>;
export const rememberedCommandSchema = undeclaredCommandSchema.extend({
  id: z.string(),
  folderName: z.string().optional(),
  folderPath: z.string().optional(),
});
export const commandPolicySchema = z.object({
  identity: z.string(),
  signed: z.boolean(),
  mode: commandModeSchema,
  approvals: z.array(rememberedCommandSchema).max(256),
});
export type CommandPolicy = z.infer<typeof commandPolicySchema>;
export const commandAccessSchema = commandPolicySchema.omit({
  identity: true,
  signed: true,
});
export const commandAskSchema = undeclaredCommandSchema.extend({
  id: z.string(),
  pluginId: z.string(),
  pluginName: z.string(),
  signed: z.boolean().default(false),
  resolvedExecutable: z.string().optional(),
  folderPath: z.string().optional(),
  folderName: z.string(),
  /**
   * The repository folder an Always answer is kept for, when the command
   * runs in one of its worktrees (#860). Absent, `folderName` is that
   * repository folder. Either way the approval covers the repository folder
   * and all its worktrees.
   */
  scopeFolderName: z.string().optional(),
  risky: z.boolean(),
  reason: z.string().optional(),
  expiresAt: z.number(),
});
export type CommandAsk = z.infer<typeof commandAskSchema>;
export const commandAnswerSchema = z
  .object({
    id: z.string(),
    answer: z.enum(["once", "always", "deny", "deny-all"]),
  })
  .strict();

/**
 * Shows a resolved executable, folder name or path as-is, except that
 * invisible, blank, unassigned and surrogate characters, whitespace other
 * than a space, and a backslash that would read as an escape become
 * `\u{XXXX}`.
 */
export function displayCommandText(value: string): string {
  return value.replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Cs}\p{Cn}⠀]|[^\S ]|\\(?=u\{)/gu,
    (c) => `\\u{${c.codePointAt(0)!.toString(16).toUpperCase()}}`,
  );
}

/**
 * Shows argv with visible boundaries: an element with a space or quote, or
 * an empty one, is quoted, with inner quotes and the backslashes before
 * them or before the closing quote escaped.
 */
export function displayCommandLine(argv: readonly string[]): string {
  return argv
    .map((arg) => {
      const shown = displayCommandText(arg);
      if (shown !== "" && !/[ "]/.test(shown)) return shown;
      return `"${shown
        .replace(/(\\*)"/g, '$1$1\\"')
        .replace(/(\\+)$/, "$1$1")}"`;
    })
    .join(" ");
}
