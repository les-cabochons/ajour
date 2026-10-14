import type {
  ActivityBlockRecord,
  BlockSuggestion,
  FeatureSnapshot,
  FeatureStat,
  RuleCondition,
  RuleEvaluationResult,
  RuleRecord,
} from "../types/domain";
import { clamp } from "../utils/time";

const featureWeights = {
  exactTitle: 1.0,
  "domain+pathnamePrefix": 0.95,
  pathnamePrefix: 0.8,
  "domain+titleContains": 0.75,
  domain: 0.45,
  titleContains: 0.35,
} as const;

function matchesCondition(
  block: ActivityBlockRecord,
  condition: RuleCondition,
): boolean {
  if (condition.domain && block.domain !== condition.domain) {
    return false;
  }
  if (
    condition.pathnamePrefix &&
    !block.pathname.startsWith(condition.pathnamePrefix)
  ) {
    return false;
  }
  if (
    condition.titleContains &&
    !block.title.includes(condition.titleContains.toLowerCase())
  ) {
    return false;
  }
  if (
    condition.exactTitle &&
    block.title !== condition.exactTitle.toLowerCase()
  ) {
    return false;
  }
  return true;
}

function explainRule(condition: RuleCondition): string {
  const parts = [
    condition.domain ? `domain=${condition.domain}` : undefined,
    condition.pathnamePrefix
      ? `path starts with ${condition.pathnamePrefix}`
      : undefined,
    condition.titleContains
      ? `title contains ${condition.titleContains}`
      : undefined,
    condition.exactTitle ? `exact title ${condition.exactTitle}` : undefined,
  ].filter(Boolean);

  return `Matched rule: ${parts.join(" and ")}`;
}

export function extractFeatureSnapshots(
  block: Pick<ActivityBlockRecord, "domain" | "pathname" | "title">,
): FeatureSnapshot[] {
  const features: FeatureSnapshot[] = [
    { featureType: "domain", featureValue: block.domain },
  ];

  if (block.pathname && block.pathname !== "/") {
    features.push({
      featureType: "pathnamePrefix",
      featureValue: block.pathname,
    });
    features.push({
      featureType: "domain+pathnamePrefix",
      featureValue: `${block.domain}|${block.pathname}`,
    });
  }

  if (block.title) {
    features.push({ featureType: "exactTitle", featureValue: block.title });
    const firstTokens = block.title.split(" ").slice(0, 4).join(" ");
    if (firstTokens) {
      features.push({
        featureType: "titleContains",
        featureValue: firstTokens,
      });
      features.push({
        featureType: "domain+titleContains",
        featureValue: `${block.domain}|${firstTokens}`,
      });
    }
  }

  return features;
}

function buildHistorySuggestion(
  block: ActivityBlockRecord,
  stats: FeatureStat[],
): RuleEvaluationResult {
  const byFeature = new Map<string, FeatureStat[]>();
  for (const stat of stats) {
    const key = `${stat.featureType}:${stat.featureValue}`;
    const list = byFeature.get(key) ?? [];
    list.push(stat);
    byFeature.set(key, list);
  }

  const candidateScores = new Map<
    string,
    { score: number; support: number; explanations: string[] }
  >();

  for (const feature of extractFeatureSnapshots(block)) {
    const key = `${feature.featureType}:${feature.featureValue}`;
    const matches = byFeature.get(key) ?? [];
    const total = matches.reduce((sum, item) => sum + item.matchCount, 0);
    if (total === 0) {
      continue;
    }

    for (const item of matches) {
      const precision = item.matchCount / total;
      const weighted = precision * featureWeights[feature.featureType];
      const entry = candidateScores.get(item.projectId) ?? {
        score: 0,
        support: 0,
        explanations: [],
      };
      entry.score += weighted;
      entry.support += item.matchCount;
      entry.explanations.push(
        `${item.matchCount} previous ${feature.featureValue} blocks matched this project`,
      );
      candidateScores.set(item.projectId, entry);
    }
  }

  const ranked = [...candidateScores.entries()]
    .map(([projectId, value]) => ({
      projectId,
      score: clamp(value.score, 0, 1),
      support: value.support,
      explanation: value.explanations[0] ?? "Historical match",
    }))
    .sort((a, b) => b.score - a.score || b.support - a.support);

  const top = ranked[0];
  if (!top || top.score < 0.65 || top.support < 2) {
    return { candidateScores: ranked };
  }

  const suggestion: BlockSuggestion = {
    projectId: top.projectId,
    confidence: top.score,
    source: top.score >= 0.9 ? "auto" : "history",
    explanation: `Suggested from history: ${top.explanation}`,
  };

  return {
    suggestion,
    matchedBy: "history",
    candidateScores: ranked,
  };
}

export function evaluateBlockAgainstRules(
  block: ActivityBlockRecord,
  rules: RuleRecord[],
  stats: FeatureStat[],
): RuleEvaluationResult {
  const sortedRules = [...rules]
    .filter((rule) => rule.enabled && rule.status === "active")
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (!matchesCondition(block, rule.condition)) {
      continue;
    }

    return {
      suggestion: {
        projectId: rule.targetProjectId,
        confidence: rule.baseConfidence,
        source:
          rule.action === "auto_assign" && rule.baseConfidence >= 0.9
            ? "auto"
            : "rule",
        explanation: explainRule(rule.condition),
        ruleId: rule.id,
      },
      matchedRuleId: rule.id,
      matchedBy: "rule",
      candidateScores: [],
    };
  }

  return buildHistorySuggestion(block, stats);
}
