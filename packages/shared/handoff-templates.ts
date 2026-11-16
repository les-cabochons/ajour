import { z } from "zod";
import { fillTemplate } from "./agent-task-templates.ts";
import { splitDescription } from "./description-frontmatter.ts";
export const HANDOFF_SLOTS = [
  "item.key",
  "item.title",
  "item.description",
  "item.url",
  "item.type",
  "item.parent.key",
  "item.parent.title",
  "project.name",
  "repo.name",
] as const;
export interface HandoffTemplateContext {
  item: {
    key: string;
    title: string;
    description?: string;
    url: string;
    type: string;
    parent?: { key: string; title: string };
  };
  projectName: string;
  repoName: string;
}
export function handoffTemplateDefaults(prompt?: string) {
  return {
    prompt:
      prompt ??
      "{{item.key}} {{item.title}}\n\n{{item.description}}\n\n{{item.url}}",
    title: "[{{item.key}}] {{item.title}}",
    branch: "{{item.key|slug}}-{{item.title|slug}}",
  };
}
export const handoffTemplateSchema = z
  .string()
  .refine(
    (s) => new TextEncoder().encode(s).length <= 16384,
    "Template exceeds 16 KB.",
  )
  .superRefine((s, ctx) => {
    try {
      fillTemplate(
        s,
        Object.fromEntries(HANDOFF_SLOTS.map((slot) => [slot, ""])),
      );
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid template.",
      });
    }
  });
export const handoffTemplatesSchema = z
  .object({
    prompt: handoffTemplateSchema,
    title: handoffTemplateSchema,
    branch: handoffTemplateSchema,
  })
  .strict();
export type HandoffTemplates = z.infer<typeof handoffTemplatesSchema>;
/** Retains at most 32 KiB of UTF-8 description, including the ellipsis line. */
export function handoffDescription(description = "") {
  const body = splitDescription(description).body;
  if (new TextEncoder().encode(body).length <= 32768) return body;
  let result = "",
    bytes = 0;
  for (const char of body) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 32764) break;
    result += char;
    bytes += size;
  }
  return result + "\n\u2026";
}
export function fillHandoffTemplates(
  templates: HandoffTemplates,
  context: HandoffTemplateContext,
): HandoffTemplates {
  const { item } = context;
  const values = {
    "item.key": item.key,
    "item.title": item.title,
    "item.description": handoffDescription(item.description),
    "item.url": item.url,
    "item.type": item.type,
    "item.parent.key": item.parent?.key ?? "",
    "item.parent.title": item.parent?.title ?? "",
    "project.name": context.projectName,
    "repo.name": context.repoName,
  };
  return {
    prompt: fillTemplate(templates.prompt, values),
    title: fillTemplate(templates.title, values),
    branch: fillTemplate(templates.branch, values),
  };
}

/** Same git ref rules for previews, handoff starts and process arguments. */
export function isValidHandoffBranch(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("-") &&
    value !== "@" &&
    !value.endsWith(".") &&
    !/[\x00-\x20\x7f~^:?*\[\\]|\.\.|@\{|\/\/|^\/|\/$/.test(value) &&
    !value.split("/").some((p) => p.startsWith(".") || p.endsWith(".lock"))
  );
}
export function handoffTitle(value: string): string {
  const line = value.replace(/(?:\r\n|[\r\n\u2028\u2029])+/g, " ");
  let result = "";
  for (const char of line) {
    if (result.length + char.length > 500) break;
    result += char;
  }
  return result;
}
