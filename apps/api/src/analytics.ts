import type { Context, Hono } from "hono";
import { addDays } from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";
import { scoringContext } from "./workouts";

const CLUB_ID = clubCatalog.id;
type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

interface Session {
  user_id: string;
  profile_id: string | null;
}

export function registerAnalyticsRoutes(
  app: Hono<AppEnv>,
  currentSession: (c: AppContext) => Promise<Session | null>,
): void {
  app.get("/api/dashboard", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    if (!session.profile_id) return c.json({ error: "Create a training profile first." }, 409);
    const context = await scoringContext(c.env.DB);
    const profileId = session.profile_id;
    const [week, month, offseason, byType, days] = await Promise.all([
      periodTotal(c.env.DB, profileId, context.week.start, context.week.end),
      periodTotal(c.env.DB, profileId, context.month.start, context.month.end),
      periodTotal(c.env.DB, profileId, context.offseasonStart, context.offseasonEnd),
      c.env.DB.prepare(
        `SELECT w.type AS type, COALESCE(SUM(t.points_tenths), 0) AS points_tenths, COUNT(DISTINCT w.id) AS sessions
         FROM workouts w
         LEFT JOIN point_transactions t ON t.workout_id = w.id
         WHERE w.player_profile_id = ? AND w.status IN ('submitted', 'approved')
           AND w.occurred_on >= ? AND w.occurred_on <= ?
         GROUP BY w.type
         ORDER BY points_tenths DESC`,
      ).bind(profileId, context.offseasonStart, context.offseasonEnd).all<{ type: string; points_tenths: number; sessions: number }>(),
      c.env.DB.prepare(
        `SELECT w.occurred_on AS occurred_on, COALESCE(SUM(t.points_tenths), 0) AS points_tenths
         FROM workouts w
         LEFT JOIN point_transactions t ON t.workout_id = w.id
         WHERE w.player_profile_id = ? AND w.status IN ('submitted', 'approved') AND w.occurred_on >= ?
         GROUP BY w.occurred_on`,
      ).bind(profileId, addDays(context.week.start, -7 * 7)).all<{ occurred_on: string; points_tenths: number }>(),
    ]);
    const dates = await c.env.DB.prepare(
      `SELECT DISTINCT occurred_on AS occurred_on FROM workouts
       WHERE player_profile_id = ? AND status IN ('submitted', 'approved') AND occurred_on >= ?
       ORDER BY occurred_on DESC`,
    ).bind(profileId, addDays(context.today, -120)).all<{ occurred_on: string }>();
    return c.json({
      today: context.today,
      streak: streakFrom(dates.results.map((row) => row.occurred_on), context.today),
      week: { ...context.week, ...week },
      month: { ...context.month, ...month },
      offseason: { start: context.offseasonStart, end: context.offseasonEnd, ...offseason },
      byType: byType.results.map((row) => ({ ...row, points_tenths: Number(row.points_tenths), sessions: Number(row.sessions) })),
      weeks: bucketWeeks(context.week.start, days.results),
    });
  });

  app.get("/api/team", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const context = await scoringContext(c.env.DB);
    const since = addDays(context.week.start, -7 * 7);
    const [roster, active, daily, movers] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM player_profiles pr
         JOIN club_memberships m ON m.id = pr.membership_id
         WHERE m.club_id = ? AND m.status = 'active'`,
      ).bind(CLUB_ID).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT w.player_profile_id) AS n
         FROM workouts w
         JOIN player_profiles pr ON pr.id = w.player_profile_id
         JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ?
         WHERE w.status IN ('submitted', 'approved') AND w.occurred_on >= ? AND w.occurred_on <= ?`,
      ).bind(CLUB_ID, context.week.start, context.week.end).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT w.occurred_on AS occurred_on,
                CASE WHEN g.id = 'group_forwards' THEN 'forwards' WHEN g.id = 'group_backs' THEN 'backs' ELSE 'coaches' END AS bucket,
                COALESCE(SUM(t.points_tenths), 0) AS points_tenths
         FROM workouts w
         JOIN player_profiles pr ON pr.id = w.player_profile_id
         JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ?
         LEFT JOIN groups g ON g.id = pr.group_id
         LEFT JOIN point_transactions t ON t.workout_id = w.id
         WHERE w.status IN ('submitted', 'approved') AND w.occurred_on >= ?
         GROUP BY w.occurred_on, bucket`,
      ).bind(CLUB_ID, since).all<{ occurred_on: string; bucket: string; points_tenths: number }>(),
      c.env.DB.prepare(
        `SELECT pr.id AS profile_id, pr.roster_name AS roster_name,
                COALESCE(SUM(CASE WHEN w.occurred_on >= ? AND w.occurred_on <= ? THEN t.points_tenths ELSE 0 END), 0) AS this_week,
                COALESCE(SUM(CASE WHEN w.occurred_on >= ? AND w.occurred_on <= ? THEN t.points_tenths ELSE 0 END), 0) AS last_week
         FROM player_profiles pr
         JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ? AND m.status = 'active'
         LEFT JOIN workouts w ON w.player_profile_id = pr.id AND w.status IN ('submitted', 'approved')
           AND w.occurred_on >= ? AND w.occurred_on <= ?
         LEFT JOIN point_transactions t ON t.workout_id = w.id
         GROUP BY pr.id, pr.roster_name`,
      ).bind(
        context.week.start,
        context.week.end,
        context.lastWeek.start,
        context.lastWeek.end,
        CLUB_ID,
        context.lastWeek.start,
        context.week.end,
      ).all<{ profile_id: string; roster_name: string; this_week: number; last_week: number }>(),
    ]);
    const rosterCount = Number(roster?.n ?? 0);
    const activeCount = Number(active?.n ?? 0);
    return c.json({
      participation: {
        active: activeCount,
        roster: rosterCount,
        rate: rosterCount === 0 ? 0 : Math.round((activeCount / rosterCount) * 1000) / 1000,
      },
      weeks: bucketWeeks(context.week.start, daily.results.map((row) => ({ occurred_on: row.occurred_on, points_tenths: Number(row.points_tenths) }))),
      groups: bucketGroups(context.week.start, daily.results),
      movers: movers.results.map((row) => ({
        profileId: row.profile_id,
        rosterName: row.roster_name,
        thisWeek: Number(row.this_week),
        lastWeek: Number(row.last_week),
        delta: Number(row.this_week) - Number(row.last_week),
      })).sort((a, b) => b.delta - a.delta || a.rosterName.localeCompare(b.rosterName)).slice(0, 5),
    });
  });
}

async function periodTotal(db: D1Database, profileId: string, start: string | null, end: string | null) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(t.points_tenths), 0) AS points_tenths, COUNT(DISTINCT w.id) AS sessions
     FROM workouts w
     LEFT JOIN point_transactions t ON t.workout_id = w.id
     WHERE w.player_profile_id = ? AND w.status IN ('submitted', 'approved')
       AND w.occurred_on >= ? AND w.occurred_on <= ?`,
  ).bind(profileId, start, end).first<{ points_tenths: number; sessions: number }>();
  return { pointsTenths: Number(row?.points_tenths ?? 0), sessions: Number(row?.sessions ?? 0) };
}

function streakFrom(dates: string[], today: string): number {
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

function weekIndex(weekStart: string, occurredOn: string): number {
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  const day = Date.parse(`${occurredOn}T00:00:00Z`);
  return Math.floor((day - start) / (7 * 24 * 60 * 60 * 1000));
}

function bucketWeeks(currentStart: string, rows: { occurred_on: string; points_tenths: number }[]) {
  const origin = addDays(currentStart, -7 * 7);
  const totals = Array.from({ length: 8 }, (_, index) => ({ start: addDays(origin, index * 7), pointsTenths: 0 }));
  for (const row of rows) {
    const index = weekIndex(origin, row.occurred_on);
    if (index >= 0 && index < 8) totals[index]!.pointsTenths += Number(row.points_tenths);
  }
  return totals;
}

function bucketGroups(currentStart: string, rows: { occurred_on: string; bucket: string; points_tenths: number }[]) {
  const origin = addDays(currentStart, -7 * 7);
  const totals = Array.from({ length: 8 }, (_, index) => ({
    start: addDays(origin, index * 7),
    forwards: 0,
    backs: 0,
    coaches: 0,
  }));
  for (const row of rows) {
    const index = weekIndex(origin, row.occurred_on);
    if (index < 0 || index >= 8) continue;
    const bucket = totals[index]!;
    if (row.bucket === "forwards") bucket.forwards += Number(row.points_tenths);
    else if (row.bucket === "backs") bucket.backs += Number(row.points_tenths);
    else bucket.coaches += Number(row.points_tenths);
  }
  return totals;
}
