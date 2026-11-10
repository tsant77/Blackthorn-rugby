import type { Context, Hono } from "hono";
import { addDays } from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";
import { scoringContext } from "./workouts";

export const EXERCISES = ["leg press", "squat", "bench press"] as const;
export interface Lift { name: string; sets: number; reps: number; loadGrams: number }
export interface Metrics { calories: number | null; calorieSource: string | null; exercises: Lift[] }

/** Strict optional input: omitted fields on PATCH retain previously recorded metrics. */
export function parseMetrics(body: Record<string, unknown>): Metrics | null {
  const calories = body.calories == null ? null : body.calories;
  const calorieSource = body.calorieSource == null ? null : body.calorieSource;
  if (calories !== null && (typeof calories !== "number" || !Number.isInteger(calories) || calories < 1 || calories > 10000)) return null;
  if (calories !== null && calorieSource !== "device" && calorieSource !== "estimated") return null;
  if (calories === null && calorieSource !== null) return null;
  if (body.exercises !== undefined && (!Array.isArray(body.exercises) || body.exercises.length > 20)) return null;
  const exercises: Lift[] = [];
  for (const raw of (body.exercises ?? []) as unknown[]) {
    if (!raw || typeof raw !== "object") return null;
    const e = raw as Record<string, unknown>;
    if (typeof e.name !== "string") return null;
    const name = e.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!EXERCISES.includes(name as typeof EXERCISES[number])) return null;
    const sets = e.sets == null ? 1 : e.sets;
    if (typeof sets !== "number" || !Number.isInteger(sets) || sets < 1 || sets > 100 ||
        typeof e.reps !== "number" || !Number.isInteger(e.reps) || e.reps < 1 || e.reps > 1000 ||
        typeof e.loadGrams !== "number" || !Number.isInteger(e.loadGrams) || e.loadGrams <= 0 || e.loadGrams > 400000) return null;
    exercises.push({ name, sets, reps: e.reps, loadGrams: e.loadGrams });
  }
  return { calories: calories as number | null, calorieSource: calorieSource as string | null, exercises };
}

export function metricStatements(db: D1Database, id: string, body: Record<string, unknown>, metrics: Metrics, now: number) {
  const statements: D1PreparedStatement[] = [];
  if ("calories" in body || "calorieSource" in body) statements.push(db.prepare("UPDATE workouts SET calories=?,calorie_source=? WHERE id=?").bind(metrics.calories, metrics.calorieSource, id));
  if ("exercises" in body) {
    statements.push(db.prepare("DELETE FROM workout_exercises WHERE workout_id=?").bind(id));
    metrics.exercises.forEach((e, index) => statements.push(db.prepare(`INSERT INTO workout_exercises
      (id,workout_id,club_id,name,sets,reps,load_grams,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), id, clubCatalog.id, e.name, e.sets, e.reps, e.loadGrams, index, now)));
  }
  return statements;
}

// Correlated only against the bounded history page (or one saved workout).
export const metricColumns = `w.calories,w.calorie_source,
  (SELECT json_group_array(json_object('name',e.name,'sets',e.sets,'reps',e.reps,'loadGrams',e.load_grams))
   FROM (SELECT * FROM workout_exercises WHERE workout_id=w.id ORDER BY sort_order) e) AS exercises_json`;

type AppEnv = { Bindings: Env };
type Session = { user_id: string; profile_id: string | null };
export function registerPerformanceRoutes(app: Hono<AppEnv>, currentSession: (c: Context<AppEnv>) => Promise<Session | null>) {
  app.get("/api/performance", async c => {
    const session = await currentSession(c);
    if (!session?.profile_id) return c.json({ error: "Sign in with a training profile." }, 401);
    const context = await scoringContext(c.env.DB);
    const period = c.req.query("period") ?? "offseason";
    if (!["week", "month", "offseason"].includes(period)) return c.json({ error: "Invalid period." }, 400);
    const range = period === "week" ? context.week : period === "month" ? context.month : { start: context.offseasonStart, end: context.offseasonEnd };
    const start = range.start ?? "0001-01-01", end = range.end ?? context.today;
    const [weekly, records, privacy] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT occurred_on,type,SUM(distance_m) AS distance_m,SUM(calories) AS calories,
        COUNT(*) AS sessions FROM workouts WHERE player_profile_id=? AND status IN ('submitted','approved')
        AND occurred_on BETWEEN ? AND ? GROUP BY occurred_on,type ORDER BY occurred_on`)
        .bind(session.profile_id, addDays(context.week.start, -49), context.today),
      c.env.DB.prepare(`SELECT e.name,e.reps,MAX(e.load_grams) AS load_grams,
        SUM(e.load_grams*COALESCE(e.sets,1)*e.reps) AS volume_grams FROM workout_exercises e JOIN workouts w ON w.id=e.workout_id
        WHERE w.player_profile_id=? AND w.status IN ('submitted','approved') AND w.occurred_on BETWEEN ? AND ?
        AND e.load_grams>0 AND e.reps>0 GROUP BY e.name,e.reps ORDER BY e.name,e.reps LIMIT 200`).bind(session.profile_id, start, end),
      c.env.DB.prepare("SELECT performance_public FROM player_profiles WHERE id=?").bind(session.profile_id),
    ]);
    const weeks = Array.from({ length: 8 }, (_, i) => ({ start: addDays(context.week.start, (i - 7) * 7), runningM: 0, cyclingM: 0, rowingM: 0, calories: 0, sessions: 0 }));
    for (const raw of weekly.results) {
      const row = raw as { occurred_on: string; type: string; distance_m: number | null; calories: number | null; sessions: number };
      const index = Math.floor((Date.parse(row.occurred_on) - Date.parse(weeks[0]!.start)) / 604800000);
      const week = weeks[index];
      if (!week) continue;
      if (row.type === "running") week.runningM += row.distance_m ?? 0;
      if (row.type === "cycling") week.cyclingM += row.distance_m ?? 0;
      if (row.type === "rower") week.rowingM += row.distance_m ?? 0;
      week.calories += row.calories ?? 0; week.sessions += row.sessions;
    }
    return c.json({ period, ...range, weeks, records: records.results, performancePublic: (privacy.results[0] as { performance_public: number } | undefined)?.performance_public === 1, exercises: EXERCISES });
  });

  app.patch("/api/performance/privacy", async c => {
    const session = await currentSession(c);
    if (!session?.profile_id) return c.json({ error: "Sign in with a training profile." }, 401);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.performancePublic !== "boolean") return c.json({ error: "Choose a visibility setting." }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE player_profiles SET performance_public=?,updated_at=? WHERE id=?").bind(body.performancePublic ? 1 : 0, Date.now(), session.profile_id),
    ]);
    return c.json({ ok: true });
  });

  app.get("/api/performance/leaderboard", async c => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const metric = c.req.query("metric") ?? "running";
    const period = c.req.query("period") ?? "week";
    const exercise = c.req.query("exercise") ?? "bench press";
    const reps = Number(c.req.query("reps") ?? "1");
    if (!["running", "cycling", "rowing", "strength", "improvement", "consistency"].includes(metric) ||
        !["week", "month", "offseason"].includes(period) || !EXERCISES.includes(exercise as typeof EXERCISES[number]) ||
        !Number.isInteger(reps) || reps < 1 || reps > 1000) return c.json({ error: "Invalid leaderboard filter." }, 400);
    const context = await scoringContext(c.env.DB);
    const range = period === "week" ? context.week : period === "month" ? context.month : { start: context.offseasonStart, end: context.offseasonEnd };
    const start = range.start ?? "0001-01-01", end = range.end ?? context.today;
    const group = c.req.query("groupId") ?? null, position = c.req.query("positionId") ?? null;
    const bindings: (string | number | null)[] = [clubCatalog.id, start, end, group, group, group, position, position];
    const base = `FROM workouts w JOIN player_profiles p ON p.id=w.player_profile_id
      JOIN club_memberships m ON m.id=p.membership_id
      WHERE m.club_id=? AND m.status='active' AND p.performance_public=1 AND w.status IN ('submitted','approved')
      AND w.occurred_on BETWEEN ? AND ?
      AND (? IS NULL OR (?='coaches' AND m.role IN ('coach','admin')) OR p.group_id=?)
      AND (? IS NULL OR p.position_id=?)`;
    let query: string;
    if (metric === "strength" || metric === "improvement") {
      // Compare actual loads at the SAME rep count; no estimated 1RM or maximal attempt required.
      query = `WITH eligible AS (SELECT w.id,w.player_profile_id,w.occurred_on,w.created_at ${base}),
        days AS (SELECT x.player_profile_id,x.occurred_on,MAX(e.load_grams) AS load_grams
        FROM eligible x JOIN workout_exercises e ON e.workout_id=x.id WHERE e.name=? AND e.reps=?
        GROUP BY x.player_profile_id,x.occurred_on),
        stats AS (SELECT player_profile_id,MAX(load_grams) AS best,MIN(occurred_on) AS first_day FROM days GROUP BY player_profile_id)
        SELECT s.player_profile_id AS profile_id,${metric === "strength" ? "s.best" : "100.0*(s.best-d.load_grams)/d.load_grams"} AS value,
        d.load_grams AS baseline_grams,s.best AS best_grams FROM stats s JOIN days d ON d.player_profile_id=s.player_profile_id AND d.occurred_on=s.first_day
        ${metric === "improvement" ? "WHERE EXISTS(SELECT 1 FROM days later WHERE later.player_profile_id=s.player_profile_id AND later.occurred_on>s.first_day AND later.load_grams=s.best) AND s.best>d.load_grams" : ""}`;
      bindings.push(exercise, reps);
    } else {
      const type = metric === "rowing" ? "rower" : metric;
      const expression = metric === "consistency" ? "COUNT(DISTINCT w.occurred_on)" : "SUM(w.distance_m)";
      query = `SELECT p.id AS profile_id,${expression} AS value ${base} AND ${metric === "consistency" ? "w.duration_min>=?" : "w.type=? AND w.distance_m>0"} GROUP BY p.id HAVING value>0`;
      bindings.push(metric === "consistency" ? context.rule.consistencyMinMinutes ?? 20 : type);
    }
    const rows = await c.env.DB.prepare(`WITH scores AS (${query}) SELECT scores.*,p.roster_name,
      pos.name AS position_name,g.name AS group_name,RANK() OVER(ORDER BY value DESC) AS rank
      FROM scores JOIN player_profiles p ON p.id=scores.profile_id LEFT JOIN positions pos ON pos.id=p.position_id
      LEFT JOIN groups g ON g.id=p.group_id ORDER BY value DESC,p.roster_name,p.id LIMIT 100`).bind(...bindings).all();
    return c.json({ metric, period, exercise, reps, ...range, standings: rows.results, limit: 100 });
  });
}
