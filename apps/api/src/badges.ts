import { civilDateInTimeZone } from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import { earnedKeys, parseCriteria, streakDays, type AthleteStats } from "./awards";
import type { Env } from "./app";
import { notifyUser, optedIn } from "./notify";

const CLUB_ID = clubCatalog.id;

export async function syncBadges(env: Env, profileId: string, now = Date.now()): Promise<string[]> {
  const [owners, definitions, counts, dates, points, have] = await env.DB.batch([
    env.DB.prepare(
      `SELECT u.id AS user_id, u.email, u.email_notifications
       FROM player_profiles pr
       JOIN club_memberships m ON m.id = pr.membership_id
       JOIN users u ON u.id = m.user_id
       WHERE pr.id = ? AND m.club_id = ?`,
    ).bind(profileId, CLUB_ID),
    env.DB.prepare("SELECT id, key, name, criteria_json FROM achievements WHERE club_id = ?").bind(CLUB_ID),
    ...statsStatements(env.DB, profileId),
    env.DB.prepare(
      `SELECT a.key FROM player_achievements pa
       JOIN achievements a ON a.id = pa.achievement_id
       WHERE pa.player_profile_id = ?`,
    ).bind(profileId),
  ]);
  const owner = owners!.results[0] as { user_id: string; email: string; email_notifications: number } | undefined;
  if (!owner) return [];
  const parsed = (definitions!.results as { id: string; key: string; name: string; criteria_json: string }[]).flatMap((row) => {
    const criteria = parseCriteria(row.criteria_json);
    return criteria ? [{ id: row.id, key: row.key, name: row.name, criteria }] : [];
  });
  const stats = statsFromResults(counts!, dates!, points!);
  const ready = new Set(earnedKeys(parsed, stats));
  const owned = new Set((have!.results as { key: string }[]).map((row) => row.key));
  const fresh: string[] = [];
  for (const definition of parsed) {
    if (!ready.has(definition.key) || owned.has(definition.key)) continue;
    await env.DB.prepare(
      `INSERT INTO player_achievements (id, achievement_id, player_profile_id, club_id, awarded_at, source_workout_id)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).bind(crypto.randomUUID(), definition.id, profileId, CLUB_ID, now).run();
    fresh.push(definition.key);
    await notifyUser(env, {
      userId: owner.user_id,
      email: owner.email,
      emailOptIn: optedIn(owner.email_notifications),
      kind: "badge",
      title: `Badge: ${definition.name}`,
      body: `You earned ${definition.name}.`,
      dedupeKey: `badge:${definition.id}:${profileId}`,
      now,
    });
  }
  return fresh;
}

export async function loadStats(db: D1Database, profileId: string): Promise<AthleteStats> {
  const [counts, dates, points] = await db.batch(statsStatements(db, profileId));
  return statsFromResults(counts!, dates!, points!);
}

function statsStatements(db: D1Database, profileId: string): D1PreparedStatement[] {
  return [
    db.prepare(
      `SELECT COUNT(*) AS sessions, COUNT(DISTINCT type) AS types
       FROM workouts WHERE player_profile_id = ? AND status IN ('submitted', 'approved')`,
    ).bind(profileId),
    db.prepare(
      `SELECT DISTINCT occurred_on FROM workouts
       WHERE player_profile_id = ? AND status IN ('submitted', 'approved')`,
    ).bind(profileId),
    db.prepare(
      "SELECT COALESCE(SUM(points_tenths), 0) AS points FROM point_transactions WHERE player_profile_id = ?",
    ).bind(profileId),
  ];
}

function statsFromResults(countResult: D1Result, dates: D1Result, pointResult: D1Result): AthleteStats {
  const counts = countResult.results[0] as { sessions: number; types: number } | undefined;
  const points = pointResult.results[0] as { points: number } | undefined;
  return {
    sessionCount: Number(counts?.sessions ?? 0),
    activityTypes: Number(counts?.types ?? 0),
    pointsTenths: Number(points?.points ?? 0),
    streakDays: streakDays((dates.results as { occurred_on: string }[]).map((row) => row.occurred_on), civilDateInTimeZone(new Date(), clubCatalog.timezone)),
  };
}
