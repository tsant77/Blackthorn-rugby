import { addDays, civilDateInTimeZone } from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";
import { challengeStandings, displayValue, parseRule, type ChallengeRule, type ProgressRow } from "./challenge-math";
import { notifyUser, optedIn } from "./notify";

const CLUB_ID = clubCatalog.id;

export async function runScheduledJobs(env: Env, nowMs: number): Promise<void> {
  const today = civilDateInTimeZone(new Date(nowMs), clubCatalog.timezone);
  await transitionChallenges(env, today, nowMs);
  if (weekday(today) === 0) await sendWeeklyRecaps(env, today, nowMs);
}

export async function transitionChallenges(env: Env, today: string, now: number): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT id, title, description, start_on, end_on, rule_json FROM challenges WHERE club_id = ? AND status = 'published'",
  ).bind(CLUB_ID).all<{ id: string; title: string; description: string; start_on: string; end_on: string; rule_json: string }>();
  const members = await activeMembers(env);
  for (const row of rows.results) {
    const rule = parseRule(row.rule_json);
    if (!rule) continue;
    if (today >= row.start_on) {
      await notifyMembers(env, members, {
        kind: "challenge_start",
        title: `Challenge started: ${row.title}`,
        body: `${row.title} runs ${row.start_on} through ${row.end_on}. ${targetLine(rule)}`,
        dedupeKey: `challenge-start:${row.id}`,
        now,
      });
    }
    if (today > row.end_on) {
      const progress = await loadProgress(env.DB, row.start_on, row.end_on);
      const standings = challengeStandings(rule, progress);
      await notifyMembers(env, members, {
        kind: "challenge_end",
        title: `Challenge ended: ${row.title}`,
        body: `${row.title} is over. ${standings.summary}`,
        dedupeKey: `challenge-end:${row.id}`,
        now,
      });
      await env.DB.prepare("UPDATE challenges SET status = 'archived', updated_at = ? WHERE id = ?").bind(now, row.id).run();
    }
  }
}

export async function sendWeeklyRecaps(env: Env, monday: string, now: number): Promise<void> {
  const end = addDays(monday, -1);
  const start = addDays(monday, -7);
  const progress = await loadProgress(env.DB, start, end);
  const clubMinutes = progress.reduce((sum, row) => sum + row.minutes, 0);
  const clubSessions = progress.reduce((sum, row) => sum + row.sessions, 0);
  const clubPoints = progress.reduce((sum, row) => sum + row.pointsTenths, 0);
  for (const row of progress) {
    await notifyUser(env, {
      userId: row.userId,
      email: row.email,
      emailOptIn: row.emailOptIn,
      kind: "weekly_recap",
      title: "Your week",
      body: `Last week you logged ${row.sessions} sessions and ${displayValue("points", row.pointsTenths)} points.`,
      dedupeKey: `weekly:${start}:${row.userId}`,
      now,
    });
  }
  const staff = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, u.email_notifications
     FROM club_memberships m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN player_profiles pr ON pr.membership_id = m.id
     WHERE m.club_id = ? AND m.status = 'active' AND pr.id IS NULL AND m.role IN ('coach', 'admin')`,
  ).bind(CLUB_ID).all<{ user_id: string; email: string; email_notifications: number }>();
  for (const row of staff.results) {
    await notifyUser(env, {
      userId: row.user_id,
      email: row.email,
      emailOptIn: optedIn(row.email_notifications),
      kind: "weekly_recap",
      title: "Club week",
      body: `Last week the club logged ${clubSessions} sessions, ${clubMinutes} minutes, and ${displayValue("points", clubPoints)} points.`,
      dedupeKey: `weekly:${start}:${row.user_id}`,
      now,
    });
  }
}

export async function loadProgress(db: D1Database, start: string, end: string): Promise<Array<ProgressRow & { userId: string; email: string; emailOptIn: boolean }>> {
  const rows = await db.prepare(
    `SELECT pr.id AS profile_id, pr.roster_name, pr.group_id, g.name AS group_name,
            u.id AS user_id, u.email, u.email_notifications,
            COALESCE(SUM(w.duration_min), 0) AS minutes,
            COALESCE(SUM(w.distance_m), 0) AS meters,
            COUNT(w.id) AS sessions
     FROM player_profiles pr
     JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ? AND m.status = 'active'
     JOIN users u ON u.id = m.user_id
     LEFT JOIN groups g ON g.id = pr.group_id
     LEFT JOIN workouts w ON w.player_profile_id = pr.id AND w.club_id = ?
       AND w.status IN ('submitted', 'approved') AND w.occurred_on >= ? AND w.occurred_on <= ?
     GROUP BY pr.id, pr.roster_name, pr.group_id, g.name, u.id, u.email, u.email_notifications`,
  ).bind(CLUB_ID, CLUB_ID, start, end).all<{
    profile_id: string;
    roster_name: string;
    group_id: string | null;
    group_name: string | null;
    user_id: string;
    email: string;
    email_notifications: number;
    minutes: number;
    meters: number;
    sessions: number;
  }>();
  const points = await db.prepare(
    `SELECT t.player_profile_id, COALESCE(SUM(t.points_tenths), 0) AS points
     FROM point_transactions t
     LEFT JOIN workouts w ON w.id = t.workout_id
     WHERE t.club_id = ? AND (
       (w.id IS NOT NULL AND w.status IN ('submitted', 'approved') AND w.occurred_on >= ? AND w.occurred_on <= ?)
       OR (t.workout_id IS NULL AND t.occurred_on >= ? AND t.occurred_on <= ?)
     )
     GROUP BY t.player_profile_id`,
  ).bind(CLUB_ID, start, end, start, end).all<{ player_profile_id: string; points: number }>();
  const extra = new Map(points.results.map((row) => [row.player_profile_id, Number(row.points)]));
  return rows.results.map((row) => ({
    profileId: row.profile_id,
    rosterName: row.roster_name,
    groupId: row.group_id,
    groupName: row.group_name,
    minutes: Number(row.minutes),
    meters: Number(row.meters),
    sessions: Number(row.sessions),
    pointsTenths: extra.get(row.profile_id) ?? 0,
    userId: row.user_id,
    email: row.email,
    emailOptIn: optedIn(row.email_notifications),
  }));
}

function targetLine(rule: ChallengeRule): string {
  const singular = rule.metric === "points" ? "point" : rule.metric === "minutes" ? "minute" : rule.metric === "miles" ? "mile" : "session";
  const unit = rule.target === 1 ? singular : `${singular}s`;
  const who = rule.scope === "group" ? "The group target is" : "Each player's target is";
  return `${who} ${rule.target} ${unit}.`;
}

async function activeMembers(env: Env): Promise<{ userId: string; email: string; emailOptIn: boolean }[]> {
  const rows = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, u.email_notifications
     FROM club_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.club_id = ? AND m.status = 'active' AND u.status != 'disabled'`,
  ).bind(CLUB_ID).all<{ user_id: string; email: string; email_notifications: number }>();
  return rows.results.map((row) => ({ userId: row.user_id, email: row.email, emailOptIn: optedIn(row.email_notifications) }));
}

async function notifyMembers(env: Env, members: { userId: string; email: string; emailOptIn: boolean }[], input: {
  kind: string;
  title: string;
  body: string;
  dedupeKey: string;
  now: number;
}): Promise<void> {
  for (const member of members) {
    await notifyUser(env, { ...input, userId: member.userId, email: member.email, emailOptIn: member.emailOptIn });
  }
}

function weekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (date.getUTCDay() + 6) % 7;
}
