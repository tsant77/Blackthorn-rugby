import { metersToMiles, milesToMeters } from "@blackthorn/scoring";

export type ChallengeMetric = "points" | "minutes" | "miles" | "sessions";

export interface ChallengeRule {
  scope: "individual" | "group";
  metric: ChallengeMetric;
  target: number;
  groupId: string | null;
}

export interface ProgressRow {
  profileId: string;
  rosterName: string;
  groupId: string | null;
  groupName: string | null;
  minutes: number;
  meters: number;
  sessions: number;
  pointsTenths: number;
}

export interface Standing {
  name: string;
  value: number;
  display: string;
  complete: boolean;
}

export function parseRule(raw: string): ChallengeRule | null {
  try {
    const value = JSON.parse(raw) as ChallengeRule;
    if (value.scope !== "individual" && value.scope !== "group") return null;
    if (!["points", "minutes", "miles", "sessions"].includes(value.metric)) return null;
    if (typeof value.target !== "number" || !(value.target > 0)) return null;
    return { scope: value.scope, metric: value.metric, target: value.target, groupId: value.groupId ?? null };
  } catch {
    return null;
  }
}

export function measure(metric: ChallengeMetric, row: Pick<ProgressRow, "minutes" | "meters" | "sessions" | "pointsTenths">): number {
  if (metric === "minutes") return row.minutes;
  if (metric === "sessions") return row.sessions;
  if (metric === "miles") return row.meters;
  return row.pointsTenths;
}

export function isComplete(metric: ChallengeMetric, value: number, target: number): boolean {
  if (metric === "points") return value >= Math.round(target * 10);
  if (metric === "miles") return value >= Math.round(milesToMeters(target));
  return value >= target;
}

export function displayValue(metric: ChallengeMetric, value: number): string {
  if (metric === "points") return (value / 10).toFixed(1);
  if (metric === "miles") return metersToMiles(value).toFixed(1);
  return String(value);
}

export function challengeStandings(rule: ChallengeRule, rows: ProgressRow[]): { leaders: Standing[]; sides: Standing[]; summary: string } {
  const people = rows
    .filter((row) => !rule.groupId || row.groupId === rule.groupId)
    .map((row) => standing(row.rosterName, measure(rule.metric, row), rule));
  people.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  if (rule.scope === "individual") {
    const done = people.filter((row) => row.complete).map((row) => row.name);
    const summary = done.length === 0 ? "Nobody has reached the target yet." : `${done.join(", ")} reached the target.`;
    return { leaders: people, sides: [], summary };
  }
  const groups = new Map<string, { name: string; minutes: number; meters: number; sessions: number; pointsTenths: number }>();
  for (const row of rows) {
    if (!row.groupId || !row.groupName) continue;
    if (rule.groupId && row.groupId !== rule.groupId) continue;
    const current = groups.get(row.groupId) ?? { name: row.groupName, minutes: 0, meters: 0, sessions: 0, pointsTenths: 0 };
    current.minutes += row.minutes;
    current.meters += row.meters;
    current.sessions += row.sessions;
    current.pointsTenths += row.pointsTenths;
    groups.set(row.groupId, current);
  }
  const sides = [...groups.values()]
    .map((group) => standing(group.name, measure(rule.metric, group), rule))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const leader = sides[0];
  const tied = sides.length > 1 && sides[0]?.value === sides[1]?.value;
  const summary = !leader || leader.value === 0
    ? "No group total yet."
    : tied
      ? "The groups are tied."
      : `${leader.name} lead with ${leader.display}.`;
  return { leaders: people, sides, summary };
}

function standing(name: string, value: number, rule: ChallengeRule): Standing {
  return { name, value, display: displayValue(rule.metric, value), complete: isComplete(rule.metric, value, rule.target) };
}
