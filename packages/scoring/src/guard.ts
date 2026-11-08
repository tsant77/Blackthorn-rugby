import { ClientPointsError } from "./types";

const FORBIDDEN_KEYS = new Set([
  "points",
  "awardedpoints",
  "pointstenths",
  "awardedpointstenths",
  "score",
]);

/**
 * Reject a raw client payload that tries to name its own score, at any depth.
 * Call this before mapping JSON onto `WorkoutDraft`.
 */
export function assertClientCannotSetPoints(payload: unknown): void {
  walk(payload, 0);
}

function walk(value: unknown, depth: number): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new ClientPointsError();
    }
    walk(child, depth + 1);
  }
}
