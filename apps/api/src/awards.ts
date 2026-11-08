import { addDays } from "@blackthorn/scoring";

export type BadgeCriteria =
  | { kind: "sessions"; count: number }
  | { kind: "streak"; days: number }
  | { kind: "points"; tenths: number }
  | { kind: "variety"; types: number };

export interface BadgeDefinition {
  key: string;
  criteria: BadgeCriteria;
}

export interface AthleteStats {
  sessionCount: number;
  streakDays: number;
  pointsTenths: number;
  activityTypes: number;
}

export function streakDays(dates: string[], today: string): number {
  const have = new Set(dates);
  let cursor = today;
  if (!have.has(cursor)) {
    cursor = addDays(today, -1);
    if (!have.has(cursor)) return 0;
  }
  let count = 0;
  while (have.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function parseCriteria(raw: string): BadgeCriteria | null {
  try {
    const value = JSON.parse(raw) as BadgeCriteria;
    if (value.kind === "sessions" && Number.isInteger(value.count)) return value;
    if (value.kind === "streak" && Number.isInteger(value.days)) return value;
    if (value.kind === "points" && Number.isInteger(value.tenths)) return value;
    if (value.kind === "variety" && Number.isInteger(value.types)) return value;
    return null;
  } catch {
    return null;
  }
}

export function earnedKeys(definitions: BadgeDefinition[], stats: AthleteStats): string[] {
  return definitions.filter((definition) => meets(definition.criteria, stats)).map((definition) => definition.key);
}

function meets(criteria: BadgeCriteria, stats: AthleteStats): boolean {
  if (criteria.kind === "sessions") return stats.sessionCount >= criteria.count;
  if (criteria.kind === "streak") return stats.streakDays >= criteria.days;
  if (criteria.kind === "points") return stats.pointsTenths >= criteria.tenths;
  return stats.activityTypes >= criteria.types;
}
