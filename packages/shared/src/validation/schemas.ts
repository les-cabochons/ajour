import { z } from "zod";
import {
  activityKinds,
  assignmentSources,
  browserFamilies,
  blockStatuses,
  captureModes,
  feedbackActions,
  featureTypes,
  importedDraftStatuses,
  membershipRoles,
  ruleActions,
  ruleSources,
  ruleStatuses,
  timelineDayStatuses,
  titleModes,
} from "../types/domain";

export const ruleConditionSchema = z
  .object({
    domain: z.string().min(1).optional(),
    pathnamePrefix: z.string().min(1).optional(),
    titleContains: z.string().min(1).optional(),
    exactTitle: z.string().min(1).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one rule condition is required",
  );

export const captureSettingsSchema = z.object({
  urlMode: z.enum(captureModes),
  titleMode: z.enum(titleModes),
  blockedDomains: z.array(z.string()),
  sensitiveDomains: z.array(z.string()),
  maxPathSegments: z.number().int().min(0).max(10),
});

export const reviewSettingsSchema = z.object({
  collapseMicroBlocks: z.boolean(),
  defaultReviewMode: z.enum(["all", "uncategorized", "micro"]),
});

export const extensionPairingInputSchema = z.object({
  code: z.string().min(6).max(12),
  deviceLabel: z.string().min(1).max(64),
  extensionVersion: z.string().min(1).max(32),
  platform: z.string().min(1).max(32),
});

export const activitySegmentInputSchema = z.object({
  externalSegmentId: z.string().min(8).max(128),
  startedAt: z.number().int().positive(),
  endedAt: z.number().int().positive(),
  activeDurationMs: z.number().int().nonnegative(),
  idleDurationMs: z.number().int().nonnegative(),
  isIdleSplit: z.boolean(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  context: z.object({
    url: z.string().url(),
    title: z.string().max(300),
    domain: z.string().optional(),
    pathname: z.string().optional(),
  }),
});

export const activityIdentitySchema = z.object({
  kind: z.enum(activityKinds),
  appName: z.string().min(1).max(200),
  browserFamily: z.enum(browserFamilies).optional(),
  windowTitle: z.string().max(500).optional(),
  pageTitle: z.string().max(500).optional(),
  normalizedUrl: z.string().max(1000).optional(),
  mergeKey: z.string().min(1).max(1200),
  displayTitle: z.string().min(1).max(500),
  displaySubtitle: z.string().max(1000),
});

export const activitySpanSchema = z.object({
  id: z.string().min(1).max(200),
  startedAt: z.number().int().positive(),
  endedAt: z.number().int().positive(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  identity: activityIdentitySchema,
  source: z.literal("macos_agent"),
});

export const browserContextInputSchema = z.object({
  browserFamily: z.enum(browserFamilies),
  appName: z.string().min(1).max(200),
  normalizedUrl: z.string().min(1).max(1000).optional(),
  pageTitle: z.string().max(500).optional(),
  windowTitle: z.string().max(500).optional(),
  observedAt: z.number().int().positive(),
});

export const activityLogEntrySchema = z.object({
  id: z.string().min(1).max(200),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.number().int().positive(),
  endedAt: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  bucketCount: z.number().int().positive(),
  identity: activityIdentitySchema,
  source: z.literal("macos_agent"),
});

export const extensionIngestInputSchema = z.object({
  token: z.string().min(20),
  segments: z.array(activitySegmentInputSchema).min(1).max(200),
});

export const extensionBridgeRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("TT_GET_SEGMENTS"),
    since: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("TT_GET_BUCKETS"),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    bucketSizeMs: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("TT_GET_STATUS"),
  }),
]);

export const importedDraftStatusSchema = z.enum(importedDraftStatuses);

export const blockAssignmentSchema = z.object({
  blockId: z.string(),
  projectId: z.string(),
});

export const blockMergeSchema = z.object({
  leftBlockId: z.string(),
  rightBlockId: z.string(),
});

export const blockSplitSchema = z.object({
  blockId: z.string(),
  splitAt: z.number().int().positive(),
});

export const blockRenameSchema = z.object({
  blockId: z.string(),
  label: z.string().min(1).max(120),
});

export const blockNoteSchema = z.object({
  blockId: z.string(),
  note: z.string().max(2000),
});

export const confirmDaySchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const reportFiltersSchema = z.object({
  teamId: z.string(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirmedOnly: z.boolean().optional(),
});

export const createProjectSchema = z.object({
  teamId: z.string(),
  name: z.string().min(1).max(80),
  code: z.string().max(20).optional(),
  color: z.string().regex(/^#([0-9a-fA-F]{6})$/),
});

export const updateProjectSchema = createProjectSchema.extend({
  projectId: z.string(),
});

export const createInitialTeamSchema = z.object({
  teamName: z.string().min(1).max(80),
  teamSlug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  projects: z.array(
    z.object({
      name: z.string().min(1).max(80),
      color: z.string().regex(/^#([0-9a-fA-F]{6})$/),
      code: z.string().max(20).optional(),
    }),
  ),
});

export const createRuleSchema = z.object({
  targetProjectId: z.string(),
  priority: z.number().int().min(0).max(999),
  action: z.enum(ruleActions),
  baseConfidence: z.number().min(0).max(1),
  condition: ruleConditionSchema,
});

export const updateRuleSchema = createRuleSchema.extend({
  ruleId: z.string(),
  enabled: z.boolean(),
  status: z.enum(ruleStatuses),
  source: z.enum(ruleSources).optional(),
});

export const commonLiteralCollections = {
  activityKinds,
  membershipRoles,
  browserFamilies,
  blockStatuses,
  timelineDayStatuses,
  assignmentSources,
  ruleActions,
  ruleSources,
  ruleStatuses,
  featureTypes,
  feedbackActions,
  importedDraftStatuses,
};
