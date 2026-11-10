import type { Intensity, ScoringRule } from "./types";
import { formulaTenths, roundDiv } from "./engine";

// 2024 Adult Compendium reference activities. The intensity factors below are
// club game adjustments, not additional measured MET observations.
export const MET_REFERENCES: Record<string, { met: number; code: string; source: string }> = {
  weight_training: { met: 3.5, code: "02054", source: "conditioning-exercise" },
  running: { met: 8, code: "12150", source: "running" },
  cycling: { met: 7, code: "01016", source: "bicycling" },
  rower: { met: 5, code: "02071", source: "conditioning-exercise" },
  circuit_training: { met: 5, code: "02035", source: "conditioning-exercise" },
  rugby: { met: 8.3, code: "15560", source: "sports" },
  basketball: { met: 6, code: "15050", source: "sports" },
  football: { met: 8, code: "15210", source: "sports" },
  walking: { met: 3.8, code: "17190", source: "walking" },
  sprint_hiit: { met: 7, code: "02210", source: "conditioning-exercise" },
};

export function metRule(current: ScoringRule): ScoringRule {
  const rule = structuredClone(current);
  rule.scoringModel = "met-v1";
  rule.sessionCapTenths = 1200;
  rule.dailyCapTenths = 2000;
  rule.intensityHundredths = { easy: 75, moderate: 100, hard: 125, max: 140 };
  for (const [id, type] of Object.entries(rule.types)) {
    const ref = MET_REFERENCES[id];
    if (!ref) throw new Error(`No MET reference for activity '${id}'. Map it before switching scoring.`);
    type.metHundredths = Math.round(ref.met * 100);
  }
  if (!rule.types.cycling) rule.types.cycling = { label: "Cycling", enabled: true, categories: ["endurance"],
    multiplierHundredths: 100, metHundredths: 700, allowsDistance: true, maxDistanceM: 200000, minPaceSecPerKm: 40, minSplitSecPer500: null };
  return rule;
}

export function workoutFormulaTenths(rule: ScoringRule, type: string, minutes: number, intensity: Intensity): number {
  const activity = rule.types[type]!;
  if (rule.scoringModel === "met-v1") {
    // points = MET × minutes ÷ 6 × club intensity adjustment; one final half-up rounding.
    return roundDiv(minutes * activity.metHundredths! * rule.intensityHundredths[intensity], 6000);
  }
  return formulaTenths(minutes, activity.multiplierHundredths, rule.intensityHundredths[intensity]);
}
