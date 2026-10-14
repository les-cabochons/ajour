export const captureModes = ["domain_only", "sanitized_path"] as const;
export type CaptureMode = (typeof captureModes)[number];

export const titleModes = ["off", "normalized"] as const;
export type TitleMode = (typeof titleModes)[number];

export const activityKinds = ["browser", "desktop", "manual"] as const;
export type ActivityKind = (typeof activityKinds)[number];

export const browserFamilies = [
  "chrome",
  "firefox",
  "edge",
  "brave",
  "safari",
  "unknown",
] as const;
export type BrowserFamily = (typeof browserFamilies)[number];

export const membershipRoles = ["owner", "admin", "member"] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export const blockStatuses = [
  "draft",
  "suggested",
  "edited",
  "confirmed",
] as const;
export type BlockStatus = (typeof blockStatuses)[number];

export const timelineDayStatuses = ["open", "confirmed", "reopened"] as const;
export type TimelineDayStatus = (typeof timelineDayStatuses)[number];

export const assignmentSources = [
  "none",
  "manual",
  "rule",
  "history",
  "auto",
] as const;
export type AssignmentSource = (typeof assignmentSources)[number];

export const ruleActions = ["suggest", "auto_assign"] as const;
export type RuleAction = (typeof ruleActions)[number];

export const ruleSources = ["manual", "learned"] as const;
export type RuleSource = (typeof ruleSources)[number];

export const ruleStatuses = ["active", "pending", "rejected"] as const;
export type RuleStatus = (typeof ruleStatuses)[number];

export const featureTypes = [
  "domain",
  "pathnamePrefix",
  "exactTitle",
  "titleContains",
  "domain+pathnamePrefix",
  "domain+titleContains",
] as const;
export type FeatureType = (typeof featureTypes)[number];

export const feedbackActions = [
  "manual_assign",
  "accepted_suggestion",
  "changed_suggestion",
] as const;
export type FeedbackAction = (typeof feedbackActions)[number];

export const importedDraftStatuses = [
  "draft",
  "dismissed",
  "assigned",
  "committed",
] as const;
export type ImportedDraftStatus = (typeof importedDraftStatuses)[number];

export type ReviewMode = "all" | "uncategorized" | "micro";
export type TimelineGroupMode = "none" | "project";

export interface CaptureSettings {
  urlMode: CaptureMode;
  titleMode: TitleMode;
  blockedDomains: string[];
  sensitiveDomains: string[];
  maxPathSegments: number;
}

export interface ReviewSettings {
  collapseMicroBlocks: boolean;
  defaultReviewMode: ReviewMode;
}

export interface TeamSettings {
  idleThresholdMs: number;
  mergeGapMs: number;
  microBlockThresholdMs: number;
  urlCaptureMode: CaptureMode;
  titleCaptureMode: TitleMode;
}

export interface NormalizedActivityContext {
  domain: string;
  pathname: string;
  url: string;
  title: string;
  pathTokens: string[];
  fingerprint: string;
  titleTokens: string[];
}

export interface ActivitySegmentInput {
  externalSegmentId: string;
  startedAt: number;
  endedAt: number;
  activeDurationMs: number;
  idleDurationMs: number;
  isIdleSplit: boolean;
  context: {
    url: string;
    title: string;
    domain?: string;
    pathname?: string;
  };
  localDate: string;
}

export interface ActivitySegmentRecord extends ActivitySegmentInput {
  userId: string;
  teamId: string;
  deviceId: string;
  source: "browser_extension";
  capturedUrlMode: CaptureMode;
  normalized: NormalizedActivityContext;
  createdAt: number;
}

export interface BucketTimeRange {
  localDate: string;
  bucketStartAt: number;
  bucketEndAt: number;
  bucketKey: string;
}

export interface BucketEvidenceItem {
  fingerprint: string;
  domain: string;
  pathname: string;
  title: string;
  durationMs: number;
  percentage: number;
  sourceSegmentIds: string[];
}

export interface BrowserActivityBucket extends BucketTimeRange {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  dominant: {
    domain: string;
    pathname: string;
    title: string;
    fingerprint: string;
    label: string;
    subtitle: string;
  };
  evidence: BucketEvidenceItem[];
  confidence: number;
  isMixed: boolean;
  importedAt: number;
}

export interface ActivityIdentity {
  kind: ActivityKind;
  appName: string;
  browserFamily?: BrowserFamily;
  windowTitle?: string;
  pageTitle?: string;
  normalizedUrl?: string;
  mergeKey: string;
  displayTitle: string;
  displaySubtitle: string;
}

export interface ActivitySpan {
  id: string;
  startedAt: number;
  endedAt: number;
  localDate: string;
  identity: ActivityIdentity;
  source: "macos_agent";
}

export interface DominantActivityBucket {
  bucketStartAt: number;
  bucketEndAt: number;
  winningMergeKey: string;
  dominantMs: number;
  identity: ActivityIdentity;
}

export interface ActivityLogEntry {
  id: string;
  localDate: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  bucketCount: number;
  identity: ActivityIdentity;
  source: "macos_agent";
}

export interface ActivityDisplay {
  label: string;
  subtitle: string;
}

export interface ActivityBlockRecord {
  id?: string;
  userId: string;
  teamId: string;
  localDate: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  sourceSegmentIds: string[];
  fingerprint: string;
  display: ActivityDisplay;
  status: BlockStatus;
  projectId?: string;
  assignmentSource: AssignmentSource;
  confidence: number;
  explanation?: string;
  note?: string;
  isMicroBlock: boolean;
  locked: boolean;
  domain: string;
  pathname: string;
  title: string;
  updatedAt?: number;
  confirmedAt?: number;
}

export interface RuleCondition {
  domain?: string;
  pathnamePrefix?: string;
  titleContains?: string;
  exactTitle?: string;
}

export interface BlockSuggestion {
  projectId: string;
  confidence: number;
  source: Extract<AssignmentSource, "rule" | "history" | "auto">;
  explanation: string;
  ruleId?: string;
}

export interface RuleRecord {
  id?: string;
  userId: string;
  teamId: string;
  enabled: boolean;
  priority: number;
  source: RuleSource;
  status: RuleStatus;
  action: RuleAction;
  targetProjectId: string;
  condition: RuleCondition;
  baseConfidence: number;
}

export interface RuleEvaluationResult {
  suggestion?: BlockSuggestion;
  matchedRuleId?: string;
  matchedBy?: "rule" | "history";
  candidateScores: Array<{
    projectId: string;
    score: number;
    support: number;
    explanation: string;
  }>;
}

export interface RuleProposal {
  id?: string;
  userId: string;
  teamId: string;
  targetProjectId: string;
  condition: RuleCondition;
  evidenceCount: number;
  precision: number;
  sampleBlockIds: string[];
  status: "pending" | "accepted" | "rejected";
}

export interface FeatureStat {
  featureType: FeatureType;
  featureValue: string;
  projectId: string;
  matchCount: number;
  lastMatchedAt?: number;
}

export interface AssignmentFeedback {
  blockId: string;
  projectId: string;
  action: FeedbackAction;
  suggestedProjectId?: string;
  ruleId?: string;
  featureSnapshot: FeatureSnapshot[];
  createdAt: number;
}

export interface FeatureSnapshot {
  featureType: FeatureType;
  featureValue: string;
}

export interface TimelineDayView {
  localDate: string;
  status: TimelineDayStatus;
  trackedMs: number;
  confirmedMs: number;
  blocks: ActivityBlockRecord[];
}

export type ExtensionBridgeRequest =
  | { type: "TT_GET_SEGMENTS"; since?: number }
  | { type: "TT_GET_BUCKETS"; from: number; to: number; bucketSizeMs?: number }
  | { type: "TT_GET_STATUS" };

export type ExtensionBridgeResponse =
  | { type: "TT_SEGMENTS_RESULT"; segments: ActivitySegmentInput[] }
  | { type: "TT_BUCKETS_RESULT"; buckets: BrowserActivityBucket[] }
  | { type: "TT_STATUS_RESULT"; paused: boolean; segmentCount: number }
  | { type: "TT_ERROR"; message: string };

export interface ReportFilters {
  teamId: string;
  from: string;
  to: string;
  confirmedOnly?: boolean;
}

export interface ProjectSummaryRow {
  projectId: string;
  projectName: string;
  durationMs: number;
}

export interface UserSummaryRow {
  userId: string;
  userName: string;
  durationMs: number;
}

export interface ExtensionPairingInput {
  code: string;
  deviceLabel: string;
  extensionVersion: string;
  platform: string;
}

export interface ExtensionPairingResult {
  token: string;
  deviceId: string;
  capture: CaptureSettings;
  teamId: string;
  userId: string;
}

export interface ExtensionIngestInput {
  token: string;
  segments: ActivitySegmentInput[];
}
