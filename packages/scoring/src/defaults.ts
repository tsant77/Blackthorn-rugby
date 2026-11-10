import type { Intensity, ScoringRule, TypeRule } from "./types";

const INTENSITY_HUNDREDTHS: Record<Intensity, number> = {
  easy: 85,
  moderate: 100,
  hard: 115,
  max: 125,
};

const INTENSITY_LOAD_HUNDREDTHS: Record<Intensity, number> = {
  easy: 75,
  moderate: 100,
  hard: 125,
  max: 150,
};

function typeRule(
  multiplierHundredths: number,
  extra: Partial<TypeRule> = {},
): TypeRule {
  return {
    multiplierHundredths,
    allowsDistance: false,
    maxDistanceM: null,
    minPaceSecPerKm: null,
    minSplitSecPer500: null,
    ...extra,
  };
}

/**
 * Original v1 defaults retained for historical compatibility.
 * New fitness recommendations are supplied by defaultRule() below.
 */
export function legacyRule(): ScoringRule {
  const types: Record<string, TypeRule> = {
    running: typeRule(150, {
      allowsDistance: true,
      maxDistanceM: 100_000,
      minPaceSecPerKm: 150,
    }),
    rower: typeRule(150, {
      allowsDistance: true,
      maxDistanceM: 60_000,
      minSplitSecPer500: 80,
    }),
    circuit_training: typeRule(150),
    weight_training: typeRule(125),
    rugby: typeRule(125),
    basketball: typeRule(100),
    football: typeRule(100),
  };

  return {
    version: 1,
    status: "active",
    dailyCapTenths: 300,
    sessionCapTenths: 150,
    backdateDays: 7,
    minDurationMin: 1,
    maxDurationMin: 240,
    weeklyLoadLimit: 600,
    duplicateStartWindowMin: 15,
    maxNotesLength: 500,
    maxLoadGrams: 400_000,
    allowedWhenLimited: [],
    types,
    intensityHundredths: { ...INTENSITY_HUNDREDTHS },
    intensityLoadHundredths: { ...INTENSITY_LOAD_HUNDREDTHS },
  };
}

/** Fitness defaults are published explicitly, never retroactively seeded into a live club. */
export function defaultRule(): ScoringRule {
  const rule = legacyRule();
  const activities = {
    sprint_hiit: ["Sprint / HIIT", 12, ["speed", "endurance"]],
    rugby: ["Rugby training", 11, ["strength", "speed", "endurance"]],
    running: ["Running", 10, ["endurance"]],
    circuit_training: ["Circuit training", 10, ["strength", "endurance"]],
    rower: ["Rowing", 9, ["strength", "endurance"]],
    weight_training: ["Weight training", 9, ["strength"]],
    basketball: ["Basketball", 8, ["speed", "endurance"]],
    football: ["Football", 8, ["speed", "endurance"]],
    walking: ["Walking / active recovery", 4, ["recovery"]],
  } as const;
  for (const [id, [label, points, categories]] of Object.entries(activities)) {
    rule.types[id] = { ...typeRule(points * 100), ...rule.types[id], multiplierHundredths: points * 100, label, enabled: true, categories: [...categories] };
  }
  rule.dailyCapTenths = 1000;
  rule.sessionCapTenths = 600;
  rule.intensityHundredths = { easy: 75, moderate: 100, hard: 125, max: 140 };
  rule.consistency = [{ days: 3, pointsTenths: 50 }, { days: 4, pointsTenths: 80 }, { days: 5, pointsTenths: 100 }];
  rule.consistencyMinMinutes = 20;
  return rule;
}
