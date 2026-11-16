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
          .refine((v) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v)),
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

/** Escape invisible whitespace while preserving argument boundaries. */
export function commandDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[^\x00-\x7f]/gu, (c) =>
    /[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(c)
      ? "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")
      : c,
  );
}
export function safeCommandDisplay(value: string): boolean {
  return !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}
