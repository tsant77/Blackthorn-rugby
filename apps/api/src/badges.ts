import { civilDateInTimeZone } from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import { earnedKeys, parseCriteria, streakDays, type AthleteStats } from "./awards";
import type { Env } from "./app";
import { notifyUser, optedIn } from "./notify";

const CLUB_ID = clubCatalog.id;

export async function syncBadges(env: Env, profileId: string, now = Date.now()): Promise<string[]> {
  const owner = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, u.email_notifications
     FROM player_profiles pr
     JOIN club_memberships m ON m.id = pr.membership_id
     JOIN users u ON u.id = m.user_id
     WHERE pr.id = ? AND m.club_id = ?`,
  ).bind(profileId, CLUB_ID).first<{ user_id: string; email: string; email_notifications: number }>();
  if (!owner) return [];
  const definitions = await env.DB.prepare(
    "SELECT id, key, name, criteria_json FROM achievements WHERE club_id = ?",
  ).bind(CLUB_ID).all<{ id: string; key: string; name: string; criteria_json: string }>();
  const parsed = definitions.results.flatMap((row) => {
    const criteria = parseCriteria(row.criteria_json);
    return criteria ? [{ id: row.id, key: row.key, name: row.name, criteria }] : [];
  });
  const stats = await loadStats(env.DB, profileId);
  const ready = new Set(earnedKeys(parsed, stats));
  const have = await env.DB.prepare(
    `SELECT a.key FROM player_achievements pa
     JOIN achievements a ON a.id = pa.achievement_id
     WHERE pa.player_profile_id = ?`,
  ).bind(profileId).all<{ key: string }>();
  const owned = new Set(have.results.map((row) => row.key));
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
  const counts = await db.prepare(
    `SELECT COUNT(*) AS sessions, COUNT(DISTINCT type) AS types
     FROM workouts WHERE player_profile_id = ? AND status IN ('submitted', 'approved')`,
  ).bind(profileId).first<{ sessions: number; types: number }>();
  const dates = await db.prepare(
    `SELECT DISTINCT occurred_on AS occurred_on FROM workouts
     WHERE player_profile_id = ? AND status IN ('submitted', 'approved')`,
  ).bind(profileId).all<{ occurred_on: string }>();
  const points = await db.prepare(
    "SELECT COALESCE(SUM(points_tenths), 0) AS points FROM point_transactions WHERE player_profile_id = ?",
  ).bind(profileId).first<{ points: number }>();
  return {
    sessionCount: Number(counts?.sessions ?? 0),
    activityTypes: Number(counts?.types ?? 0),
    pointsTenths: Number(points?.points ?? 0),
    streakDays: streakDays(dates.results.map((row) => row.occurred_on), civilDateInTimeZone(new Date(), clubCatalog.timezone)),
  };
}
