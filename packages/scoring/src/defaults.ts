import type { Intensity, ScoringRule, TypeRule, WorkoutType } from "./types";

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
 * Recommended rule for a new club. Publishing it is an admin action in a
 * later phase; nothing in the database is seeded from this object.
 * Keep the numbers aligned with docs/SCORING_SPEC.md.
 */
export function defaultRule(): ScoringRule {
  const types: Record<WorkoutType, TypeRule> = {
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
