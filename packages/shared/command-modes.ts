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
          .refine((v) => !/[\0\r\n]/.test(v)),
      )
      .max(100),
    cwdFolder: z.string().min(1).max(200).optional(),
  })
  .strict();
export type UndeclaredCommand = z.infer<typeof undeclaredCommandSchema>;
export const rememberedCommandSchema = undeclaredCommandSchema.extend({
  id: z.string(),
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
  folderName: z.string(),
  risky: z.boolean(),
  reason: z.string().optional(),
  expiresAt: z.number(),
});
export type CommandAsk = z.infer<typeof commandAskSchema>;
export const commandAnswerSchema = z
  .object({ id: z.string(), answer: z.enum(["once", "always", "deny"]) })
  .strict();
