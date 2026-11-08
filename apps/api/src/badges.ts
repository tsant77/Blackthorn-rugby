import { civilDateInTimeZone } from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import { earnedKeys, parseCriteria, type AthleteStats } from "./awards";
import type { Env } from "./app";

const CLUB_ID = clubCatalog.id;
type Definition = { id: string; key: string; name: string; criteria_json: string };
type StatRow = { sessions: number; types: number; points: number; streak: number };

export async function syncBadges(env: Env, profileId: string, now = Date.now()): Promise<string[]> {
  const [owners, definitions, stats, have] = await env.DB.batch([
    env.DB.prepare(
      `SELECT m.user_id FROM player_profiles pr
       JOIN club_memberships m ON m.id=pr.membership_id
       WHERE pr.id=? AND m.club_id=?`,
    ).bind(profileId, CLUB_ID),
    env.DB.prepare("SELECT id,key,name,criteria_json FROM achievements WHERE club_id=?").bind(CLUB_ID),
    statsStatement(env.DB, profileId),
    env.DB.prepare(
      `SELECT a.key FROM player_achievements pa JOIN achievements a ON a.id=pa.achievement_id
       WHERE pa.player_profile_id=?`,
    ).bind(profileId),
  ]);
  const owner = owners!.results[0] as { user_id: string } | undefined;
  if (!owner) return [];
  const parsed = (definitions!.results as Definition[]).flatMap(row => {
    const criteria = parseCriteria(row.criteria_json);
    return criteria ? [{ ...row, criteria }] : [];
  });
  const ready = new Set(earnedKeys(parsed, presentStats(stats!.results[0] as StatRow)));
  const owned = new Set((have!.results as { key: string }[]).map(row => row.key));
  const fresh = parsed.filter(row => ready.has(row.key) && !owned.has(row.key));
  if (!fresh.length) return [];
  // Keep a badge and its notification atomic. Concurrent submissions may discover
  // the same badge; the existing unique constraints make both inserts idempotent.
  const results = await env.DB.batch(fresh.flatMap(definition => [
    env.DB.prepare(
      `INSERT OR IGNORE INTO player_achievements(id,achievement_id,player_profile_id,club_id,awarded_at,source_workout_id)
       VALUES(?,?,?,?,?,NULL)`,
    ).bind(crypto.randomUUID(), definition.id, profileId, CLUB_ID, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO notifications(id,club_id,user_id,kind,title,body,dedupe_key,created_at)
       VALUES(?,?,?,'badge',?,?,?,?)`,
    ).bind(crypto.randomUUID(), CLUB_ID, owner.user_id, `Badge: ${definition.name}`,
      `You earned ${definition.name}.`, `badge:${definition.id}:${profileId}`, now),
  ]));
  return fresh.filter((_, i) => results[i * 2]!.meta.changes === 1).map(row => row.key);
}

export async function loadStats(db: D1Database, profileId: string): Promise<AthleteStats> {
  const row = await statsStatement(db, profileId).first<StatRow>();
  return presentStats(row!);
}

function statsStatement(db: D1Database, profileId: string): D1PreparedStatement {
  const today = civilDateInTimeZone(new Date(), clubCatalog.timezone);
  // Count in D1, returning one row rather than a player's lifetime of dates.
  // Each recursive step uses the player/date index and stops at the first gap.
  return db.prepare(
    `WITH RECURSIVE anchor(day) AS (
       SELECT MAX(occurred_on) FROM workouts WHERE player_profile_id=?
       AND occurred_on IN (?,date(?,'-1 day')) AND status IN ('submitted','approved')
     ), streak(day,n) AS (
       SELECT day,1 FROM anchor WHERE day IS NOT NULL
       UNION ALL SELECT date(day,'-1 day'),n+1 FROM streak
       WHERE EXISTS(SELECT 1 FROM workouts WHERE player_profile_id=?
         AND occurred_on=date(streak.day,'-1 day') AND status IN ('submitted','approved'))
     )
     SELECT COUNT(*) AS sessions,COUNT(DISTINCT type) AS types,
       (SELECT COALESCE(SUM(points_tenths),0) FROM point_transactions WHERE player_profile_id=?) AS points,
       (SELECT COALESCE(MAX(n),0) FROM streak) AS streak
     FROM workouts WHERE player_profile_id=? AND status IN ('submitted','approved')`,
  ).bind(profileId, today, today, profileId, profileId, profileId);
}

function presentStats(row: StatRow): AthleteStats {
  return { sessionCount: Number(row.sessions), activityTypes: Number(row.types),
    pointsTenths: Number(row.points), streakDays: Number(row.streak) };
}
