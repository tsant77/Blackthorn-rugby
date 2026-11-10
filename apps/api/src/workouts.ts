import { parseMetrics, metricStatements, metricColumns, type Lift } from "./performance";
import { ruleForDate } from "./scoring-rules";
import { consistencyStatements, dailyCapStatement, revisionGuard, mutationConflict } from "./fitness";
import type { Context, Hono } from "hono";
import {
  addDays,
  assertClientCannotSetPoints,
  civilDateInTimeZone,
  ClientPointsError,
  metersToMiles,
  milesToMeters,
  isRealCivilDate,
  planReversal,
  scoreWorkout,
  type Intensity,
  type PriorWorkout,
} from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";
import { syncBadges } from "./badges";

type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

const CLUB_ID = clubCatalog.id;

interface PlayerSession {
  user_id: string;
  role: string;
  profile_id: string | null;
  injury_status: string | null;
  training_locked: number | null;
}

interface WorkoutRow {
  id: string;
  type: string;
  activity_label: string;
  occurred_on: string;
  duration_min: number;
  intensity: string | null;
  distance_m: number | null;
  calories: number | null;
  calorie_source: string | null;
  exercises_json: string;
  notes: string | null;
  status: string;
  review_note: string | null;
  points_tenths: number;
  created_at: number;
}

export function registerWorkoutRoutes(
  app: Hono<AppEnv>,
  currentSession: (c: AppContext) => Promise<PlayerSession | null>,
): void {
  app.get("/api/workouts", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    if (!session.profile_id) return c.json({ error: "Finish onboarding first." }, 409);
    const limitText = c.req.query("limit") ?? "20";
    if (!/^\d{1,2}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 25) return c.json({ error: "Choose 1–25 workouts per page." }, 400);
    const status = c.req.query("status");
    if (status && status !== "counted") return c.json({ error: "Invalid workout filter." }, 400);
    const cursor = parseHistoryCursor(c.req.query("cursor"));
    if (cursor === false) return c.json({ error: "Invalid workout cursor." }, 400);
    const page = await historyPage(c.env.DB, session.profile_id, Number(limitText), cursor, status === "counted");
    // Recent cards need no current scoring configuration or calendar calculations.
    if (c.req.query("context") === "none") return c.json(page);
    const context = await scoringBasis(c.env.DB);
    return c.json({ today: context.today, minDate: context.minDate, ...page, estimateRule: context.rule });
  });

  app.get("/api/scoring-estimate", async c => {
    const session = await currentSession(c);
    if (!session?.profile_id) return c.json({ error: "Sign in required." }, 401);
    const context = await scoringBasis(c.env.DB);
    const date = c.req.query("date") ?? context.today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "Invalid date." }, 400);
    const id = c.req.query("workoutId");
    const owned = id ? await ownWorkout(c.env.DB,id,session.profile_id) : null;
    if (id && !owned) return c.json({ error: "Workout not found." }, 404);
    const selected = await ruleForDate(c.env.DB,date,owned?.rule_version_id ?? undefined);
    return c.json({ rule: selected.rule });
  });

  app.post("/api/workouts", async (c) => {
    const session = await requirePlayer(c, currentSession);
    if (session instanceof Response) return session;
    const body = await readBody(c);
    if (!body) return c.json({ error: "Invalid workout." }, 400);
    try {
      assertClientCannotSetPoints(body);
    } catch (error) {
      if (error instanceof ClientPointsError) return c.json({ error: error.message }, 400);
      throw error;
    }
    const context = await scoringBasis(c.env.DB);
    const metrics = parseMetrics(body);
    if (!metrics) return c.json({ error: "Check optional calories and exercises. Include a source and valid sets, reps and load." }, 400);
    const draft = draftFromBody(body, context.today);
    if (!draft) return c.json({ error: "Check the duration, type, and date." }, 400);
    if (draft.workout.occurredOn !== context.today) {
      const selected = await ruleForDate(c.env.DB, draft.workout.occurredOn);
      context.rule = selected.rule; context.ruleId = selected.id;
    }
    const reads = await submissionReads(c.env.DB, session.profile_id!, draft.workout.occurredOn, draft.clientRequestId);
    if (reads.existing) return c.json(await workoutPayload(c.env.DB, reads.existing.id, session.profile_id!, { idempotent: true }));

    const decision = scoreWorkout({
      workout: { ...draft.workout, exercises: metrics.exercises },
      athlete: athleteOf(session),
      rule: context.rule,
      history: reads.history,
      now: new Date(),
      timeZone: context.timeZone,
      offseasonStart: context.offseasonStart,
      offseasonEnd: context.offseasonEnd,
    });
    if (decision.outcome !== "award") return c.json({ error: decision.message, code: decision.rejectCode }, 400);

    const now = Date.now();
    const id = crypto.randomUUID();
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO workouts (
          id, club_id, player_profile_id, type, occurred_on, duration_min, intensity, distance_m, notes,
          status, client_request_id, rule_version_id, submitted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        CLUB_ID,
        session.profile_id,
        draft.workout.type,
        draft.workout.occurredOn,
        draft.workout.durationMin,
        draft.workout.intensity ?? null,
        draft.distanceM,
        draft.workout.notes ?? null,
        draft.clientRequestId,
        context.ruleId,
        now,
        now,
        now,
      ),
      ...metricStatements(c.env.DB, id, body, metrics, now),
      ...ledgerInserts(c.env.DB, session, id, context.ruleId, decision.transactions.filter(t => t.reasonCode !== "daily_cap"), now),
      dailyCapStatement(c.env.DB, session.profile_id!, id, context.ruleId, draft.workout.occurredOn, context.rule.dailyCapTenths, session.user_id, now),
      ...await consistencyStatements(c.env.DB, session.profile_id!, [draft.workout.occurredOn], session.user_id, now),
      audit(c.env.DB, session.user_id, "workout_logged", id, null, { awardedPointsTenths: decision.awardedPointsTenths }, now),
      // Read the authoritative response before leaving this scoring transaction.
      workoutStatement(c.env.DB, id, session.profile_id!),
    ];
    let saved: WorkoutRow | undefined;
    try {
      const results = await c.env.DB.batch<WorkoutRow>(statements);
      saved = results.at(-1)!.results[0];
    } catch (error) {
      if (mutationConflict(error)) return c.json({ error: "Workout changed. Reload and try again." }, 409);
      if (draft.clientRequestId) {
        const existing = await c.env.DB.prepare("SELECT id FROM workouts WHERE player_profile_id=? AND client_request_id=?").bind(session.profile_id,draft.clientRequestId).first<{ id: string }>();
        if (existing) return c.json(await workoutPayload(c.env.DB,existing.id,session.profile_id!,{ idempotent:true }));
      }
      throw error;
    }
    await syncBadges(c.env, session.profile_id!, now);
    const payload = { workout: saved ? presentWorkout(saved) : null, idempotent: false };
    const actual = payload.workout?.points_tenths ?? 0;
    return c.json({
      ...payload,
      awardedPointsTenths: actual,
      grossPointsTenths: decision.grossPointsTenths,
      flags: [...decision.flags.filter(f=>f!=="daily_cap"),...(actual < Math.min(decision.grossPointsTenths,context.rule.sessionCapTenths)?["daily_cap"]:[])],
    }, 201);
  });

  app.patch("/api/workouts/:id", async (c) => {
    const session = await requirePlayer(c, currentSession);
    if (session instanceof Response) return session;
    const owned = await ownWorkout(c.env.DB, c.req.param("id"), session.profile_id!);
    if (!owned) return c.json({ error: "Workout not found." }, 404);
    const body = await readBody(c);
    if (!body) return c.json({ error: "Invalid workout." }, 400);
    try {
      assertClientCannotSetPoints(body);
    } catch (error) {
      if (error instanceof ClientPointsError) return c.json({ error: error.message }, 400);
      throw error;
    }
    const context = await scoringMetadata(c.env.DB);
    const metrics = parseMetrics(body);
    if (!metrics) return c.json({ error: "Check optional calories and exercises. Include a source and valid sets, reps and load." }, 400);
    const draft = draftFromBody(body, context.today);
    if (!draft) return c.json({ error: "Check the duration, type, and date." }, 400);
    // The stored scoring version and bounded training history are independent reads.
    const [selected, history] = await Promise.all([
      ruleForDate(c.env.DB, draft.workout.occurredOn, owned.rule_version_id ?? undefined),
      loadHistory(c.env.DB, session.profile_id!, draft.workout.occurredOn, owned.id),
    ]);
    if (selected.effectiveOn && draft.workout.occurredOn < selected.effectiveOn) return c.json({ error: "An edit cannot move a workout before its scoring version. Delete it and log a new workout instead." }, 400);
    const decision = scoreWorkout({
      workout: { ...draft.workout, exercises: metrics.exercises, clientRequestId: null },
      athlete: athleteOf(session),
      rule: selected.rule,
      history,
      now: new Date(),
      timeZone: context.timeZone,
      offseasonStart: context.offseasonStart,
      offseasonEnd: context.offseasonEnd,
    });
    if (decision.outcome !== "award") return c.json({ error: decision.message, code: decision.rejectCode }, 400);
    const now = Date.now();
    const net = Number(owned.net_points);
    const statements = [
      revisionGuard(c.env.DB, owned.id, owned.scoring_revision, "submitted"),
      c.env.DB.prepare(
        `UPDATE workouts SET type = ?, occurred_on = ?, duration_min = ?, intensity = ?, distance_m = ?, notes = ?,
          rule_version_id = ?, updated_at = ? WHERE id = ?`,
      ).bind(
        draft.workout.type,
        draft.workout.occurredOn,
        draft.workout.durationMin,
        draft.workout.intensity ?? null,
        draft.distanceM,
        draft.workout.notes ?? null,
        selected.id,
        now,
        owned.id,
      ),
      ...metricStatements(c.env.DB, owned.id, body, metrics, now),
      ...reversalInsert(c.env.DB, session, owned.id, selected.id, net, now),
      ...ledgerInserts(c.env.DB, session, owned.id, selected.id, decision.transactions.filter(t => t.reasonCode !== "daily_cap"), now),
      dailyCapStatement(c.env.DB, session.profile_id!, owned.id, selected.id, draft.workout.occurredOn, selected.rule.dailyCapTenths, session.user_id, now),
      ...await consistencyStatements(c.env.DB, session.profile_id!, [owned.occurred_on, draft.workout.occurredOn], session.user_id, now),
      audit(c.env.DB, session.user_id, "workout_edited", owned.id, { netPointsTenths: net }, { awardedPointsTenths: decision.awardedPointsTenths }, now),
      workoutStatement(c.env.DB, owned.id, session.profile_id!),
    ];
    let saved: WorkoutRow | undefined;
    try {
      const results = await c.env.DB.batch<WorkoutRow>(statements);
      saved = results.at(-1)!.results[0];
    } catch (error) {
      if (mutationConflict(error)) return c.json({ error: "Workout changed. Reload and try again." }, 409);
      throw error;
    }
    await syncBadges(c.env, session.profile_id!, now);
    const payload = { workout: saved ? presentWorkout(saved) : null, idempotent: false };
    const actual = payload.workout?.points_tenths ?? 0;
    return c.json({
      ...payload,
      awardedPointsTenths: actual,
      flags: [...decision.flags.filter(f=>f!=="daily_cap"),...(actual < Math.min(decision.grossPointsTenths,selected.rule.sessionCapTenths)?["daily_cap"]:[])],
    });
  });

  app.delete("/api/workouts/:id", async (c) => {
    const session = await requirePlayer(c, currentSession);
    if (session instanceof Response) return session;
    const owned = await ownWorkout(c.env.DB, c.req.param("id"), session.profile_id!);
    if (!owned) return c.json({ error: "Workout not found." }, 404);
    // Deletion reverses the stored award; it does not need today's scoring rules.
    const ruleId = owned.rule_version_id ?? (await scoringBasis(c.env.DB)).ruleId;
    const now = Date.now();
    const net = Number(owned.net_points);
    try { await c.env.DB.batch([
      revisionGuard(c.env.DB, owned.id, owned.scoring_revision, "submitted"),
      c.env.DB.prepare("UPDATE workouts SET status = 'voided', review_note = 'Deleted by the player', updated_at = ? WHERE id = ?").bind(now, owned.id),
      ...reversalInsert(c.env.DB, session, owned.id, ruleId, net, now),
      ...await consistencyStatements(c.env.DB, session.profile_id!, [owned.occurred_on], session.user_id, now),
      audit(c.env.DB, session.user_id, "workout_deleted", owned.id, { netPointsTenths: net }, { status: "voided" }, now),
    ]); } catch (error) { if (mutationConflict(error)) return c.json({ error: "Workout changed. Reload and try again." }, 409); throw error; }
    // Earned badges are permanent. Removing training cannot earn a new badge.
    return c.json({ ok: true });
  });

  app.get("/api/leaderboard", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const context = await scoringContext(c.env.DB);
    const period = c.req.query("period") === "week" || c.req.query("period") === "month" ? c.req.query("period")! : "offseason";
    const range = period === "week" ? context.week : period === "month" ? context.month : { start: context.offseasonStart, end: context.offseasonEnd };
    const filter = boardFilter(c.req.query("groupId") || null, c.req.query("positionId") || null);
    const current = await standingsFor(c.env.DB, range.start, range.end, filter);
    const previous = period === "week" ? await standingsFor(c.env.DB, context.lastWeek.start, context.lastWeek.end, filter) : [];
    const previousRank = new Map(previous.map((row) => [row.profile_id, row.rank]));
    const standings = current.map((row) => {
      const prior = previousRank.get(row.profile_id) ?? null;
      return { ...row, previousRank: prior, movement: prior == null ? null : prior - row.rank };
    });
    return c.json({ period, start: range.start, end: range.end, today: context.today, standings });
  });

  app.get("/api/activity", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const profileId = c.req.query("profileId") ?? null;
    if (profileId && profileId.length>100) return c.json({error:"Invalid player."},400);
    let cursor: [number,string] | null = null;
    try {
      const raw=c.req.query("cursor");
      if(raw) {
        if(raw.length>256) throw new Error();
        const value=JSON.parse(raw);
        if(!Array.isArray(value) || value.length!==2 || !Number.isSafeInteger(value[0]) || value[0]<0 || typeof value[1]!=="string" || !value[1] || value[1].length>100) throw new Error();
        cursor=value as [number,string];
      }
    } catch { return c.json({error:"Invalid activity cursor."},400); }
    const player=profileId ? await c.env.DB.prepare("SELECT p.roster_name FROM player_profiles p JOIN club_memberships m ON m.id=p.membership_id WHERE p.id=? AND m.club_id=?").bind(profileId,CLUB_ID).first<{roster_name:string}>() : null;
    if(profileId && !player) return c.json({error:"Player not found."},404);
    const rows=await c.env.DB.prepare(
      `SELECT w.id,w.type,w.occurred_on,w.duration_min,w.created_at,pr.roster_name,
        COALESCE((SELECT SUM(points_tenths) FROM point_transactions WHERE workout_id=w.id),0) AS points_tenths
        FROM workouts w JOIN player_profiles pr ON pr.id=w.player_profile_id
        JOIN club_memberships m ON m.id=pr.membership_id AND m.club_id=?
        WHERE w.status IN ('submitted','approved') AND (? IS NULL OR pr.id=?)
        AND (? IS NULL OR (w.created_at,w.id)<(?,?))
        ORDER BY w.created_at DESC,w.id DESC LIMIT 21`
    ).bind(CLUB_ID,profileId,profileId,cursor?.[0]??null,cursor?.[0]??null,cursor?.[1]??null).all<{id:string;created_at:number}>();
    const activity=rows.results.slice(0,20),last=activity.at(-1);
    return c.json({activity,player,nextCursor:rows.results.length>20 && last?JSON.stringify([last.created_at,last.id]):null});
  });
}

async function requirePlayer(
  c: AppContext,
  currentSession: (c: AppContext) => Promise<PlayerSession | null>,
): Promise<PlayerSession | Response> {
  const session = await currentSession(c);
  if (!session) return c.json({ error: "Sign in required." }, 401);
  if (!session.profile_id) {
    return c.json({ error: "Create a training profile before logging." }, 403);
  }
  return session;
}

function athleteOf(session: PlayerSession): { injuryStatus: "available" | "limited" | "out"; trainingLocked: boolean } {
  const injuryStatus = session.injury_status === "limited" || session.injury_status === "out"
    ? session.injury_status
    : "available";
  return { injuryStatus, trainingLocked: session.training_locked === 1 };
}

async function scoringMetadata(db: D1Database) {
  const [clubs, periods] = await db.batch([
    db.prepare("SELECT timezone FROM clubs WHERE id = ?").bind(CLUB_ID),
    db.prepare(
      "SELECT start_on, end_on FROM competition_periods WHERE club_id = ? AND kind = 'offseason' AND status = 'active'",
    ).bind(CLUB_ID),
  ]);
  const club = clubs!.results[0] as { timezone: string } | undefined;
  const period = periods!.results[0] as { start_on: string; end_on: string } | undefined;
  const timeZone = club?.timezone ?? "America/New_York";
  return {
    timeZone,
    today: civilDateInTimeZone(new Date(), timeZone),
    offseasonStart: period?.start_on ?? null,
    offseasonEnd: period?.end_on ?? null,
  };
}

export async function scoringBasis(db: D1Database) {
  const metadata = await scoringMetadata(db);
  const selected = await ruleForDate(db, metadata.today);
  return {
    ...metadata,
    minDate: addDays(metadata.today, -selected.rule.backdateDays),
    rule: selected.rule,
    ruleId: selected.id,
  };
}

export async function scoringContext(db: D1Database) {
  const basis = await scoringBasis(db);
  const { today } = basis;
  const weekday = utcWeekday(today);
  const week = { start: addDays(today, -weekday), end: addDays(today, 6 - weekday) };
  const [year, month] = today.split("-").map(Number);
  const monthText = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year ?? 2026, month ?? 1, 0)).getUTCDate();
  return {
    ...basis, week,
    lastWeek: { start: addDays(week.start, -7), end: addDays(week.start, -1) },
    month: { start: `${year}-${monthText}-01`, end: `${year}-${monthText}-${String(lastDay).padStart(2, "0")}` },
  };
}

interface BoardFilter {
  coaches: boolean;
  groupId: string | null;
  positionId: string | null;
}

function boardFilter(groupId: string | null, positionId: string | null): BoardFilter {
  if (groupId === "coaches") return { coaches: true, groupId: null, positionId: null };
  return { coaches: false, groupId, positionId };
}

async function standingsFor(db: D1Database, start: string | null, end: string | null, filter: BoardFilter) {
  const rows = await db.prepare(
    `SELECT pr.id AS profile_id, pr.roster_name, m.role AS role,
            pos.id AS position_id, pos.name AS position_name,
            g.id AS group_id, g.name AS group_name,
            COALESCE(SUM(t.points_tenths), 0) AS points_tenths,
            COUNT(DISTINCT w.id) AS workout_count
     FROM player_profiles pr
     JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ? AND m.status = 'active'
     LEFT JOIN positions pos ON pos.id = pr.position_id
     LEFT JOIN groups g ON g.id = pr.group_id
     LEFT JOIN workouts w ON w.player_profile_id = pr.id AND w.club_id = ?
       AND w.status IN ('submitted', 'approved') AND w.occurred_on >= ? AND w.occurred_on <= ?
     LEFT JOIN point_transactions t ON t.workout_id = w.id
     WHERE (
       (? = 0 AND ? IS NULL AND ? IS NULL)
       OR (? = 1 AND m.role IN ('coach', 'admin'))
       OR (? = 0 AND ? IS NOT NULL AND g.id = ?)
       OR (? = 0 AND ? IS NOT NULL AND pos.id = ?)
     )
     GROUP BY pr.id, pr.roster_name, m.role, pos.id, pos.name, g.id, g.name
     ORDER BY points_tenths DESC, pr.roster_name ASC`,
  ).bind(
    CLUB_ID,
    CLUB_ID,
    start,
    end,
    filter.coaches ? 1 : 0,
    filter.groupId,
    filter.positionId,
    filter.coaches ? 1 : 0,
    filter.coaches ? 1 : 0,
    filter.groupId,
    filter.groupId,
    filter.coaches ? 1 : 0,
    filter.positionId,
    filter.positionId,
  ).all<{
    profile_id: string;
    roster_name: string;
    role: string;
    position_id: string | null;
    position_name: string | null;
    group_id: string | null;
    group_name: string | null;
    points_tenths: number;
    workout_count: number;
  }>();
  const adjustments = await db.prepare(
    `SELECT player_profile_id, COALESCE(SUM(points_tenths), 0) AS points_tenths
     FROM point_transactions
     WHERE club_id = ? AND workout_id IS NULL AND occurred_on >= ? AND occurred_on <= ?
     GROUP BY player_profile_id`,
  ).bind(CLUB_ID, start, end).all<{ player_profile_id: string; points_tenths: number }>();
  const extra = new Map(adjustments.results.map((row) => [row.player_profile_id, Number(row.points_tenths)]));
  const merged = rows.results.map((row) => ({
    ...row,
    points_tenths: Number(row.points_tenths) + (extra.get(row.profile_id) ?? 0),
    workout_count: Number(row.workout_count),
  })).sort((a, b) => b.points_tenths - a.points_tenths || a.roster_name.localeCompare(b.roster_name));
  let rank = 0;
  let previous: number | null = null;
  return merged.map((row, index) => {
    if (previous !== row.points_tenths) rank = index + 1;
    previous = row.points_tenths;
    return { ...row, rank };
  });
}

function utcWeekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (date.getUTCDay() + 6) % 7;
}

interface HistoryRow {
  id: string;
  type: string;
  occurred_on: string;
  started_at: number | null;
  ended_at: number | null;
  duration_min: number;
  intensity: Intensity | null;
  status: "submitted" | "approved";
  client_request_id: string | null;
  awarded: number;
}

function historyStatement(db: D1Database, profileId: string, occurredOn: string, excludeId: string | null) {
  return db.prepare(
    `SELECT w.id, w.type, w.occurred_on, w.started_at, w.ended_at, w.duration_min, w.intensity, w.status,
            w.client_request_id, COALESCE(SUM(t.points_tenths), 0) AS awarded
     FROM workouts w
     LEFT JOIN point_transactions t ON t.workout_id = w.id
     WHERE w.player_profile_id = ? AND w.status IN ('submitted', 'approved')
       AND w.occurred_on >= ? AND w.occurred_on <= ?
       AND (? IS NULL OR w.id != ?)
     GROUP BY w.id, w.type, w.occurred_on, w.started_at, w.ended_at, w.duration_min, w.intensity, w.status, w.client_request_id`,
  ).bind(profileId, addDays(occurredOn, -6), addDays(occurredOn, 6), excludeId, excludeId);
}

function presentHistory(rows: HistoryRow[]): PriorWorkout[] {
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    occurredOn: row.occurred_on,
    startedAt: row.started_at == null ? null : new Date(row.started_at).toISOString(),
    endedAt: row.ended_at == null ? null : new Date(row.ended_at).toISOString(),
    durationMin: row.duration_min,
    intensity: row.intensity,
    status: row.status,
    clientRequestId: row.client_request_id,
    awardedPointsTenths: Number(row.awarded),
  }));
}

async function loadHistory(db: D1Database, profileId: string, occurredOn: string, excludeId: string | null): Promise<PriorWorkout[]> {
  const rows = await historyStatement(db, profileId, occurredOn, excludeId).all<HistoryRow>();
  return presentHistory(rows.results);
}

async function submissionReads(db: D1Database, profileId: string, date: string, requestId: string | null) {
  if (!requestId) return { existing: null, history: await loadHistory(db, profileId, date, null) };
  const [matches, history] = await db.batch([
    db.prepare("SELECT id FROM workouts WHERE player_profile_id=? AND client_request_id=?").bind(profileId, requestId),
    historyStatement(db, profileId, date, null),
  ]);
  const existing = matches!.results[0] as { id: string } | undefined;
  return { existing, history: existing ? [] : presentHistory(history!.results as HistoryRow[]) };
}

function draftFromBody(body: Record<string, unknown>, today: string): {
  workout: {
    type: string;
    occurredOn: string;
    durationMin: number;
    intensity: Intensity | null;
    distanceM: number | null;
    notes: string | null;
    clientRequestId: string | null;
  };
  distanceM: number | null;
  clientRequestId: string | null;
} | null {
  if (typeof body.type !== "string") return null;
  const durationMin = body.durationMin;
  if (!Number.isInteger(durationMin)) return null;
  const occurredOn = typeof body.occurredOn === "string" && body.occurredOn ? body.occurredOn : today;
  const intensity = body.intensity == null || body.intensity === ""
    ? "moderate"
    : body.intensity;
  if (intensity !== "easy" && intensity !== "moderate" && intensity !== "hard" && intensity !== "max") return null;
  let distanceM: number | null = null;
  if (body.distanceMiles != null && body.distanceMiles !== "") {
    const miles = Number(body.distanceMiles);
    if (!Number.isFinite(miles) || miles <= 0) return null;
    distanceM = milesToMeters(miles);
  }
  if (body.distanceKilometers != null && body.distanceKilometers !== "") {
    if (distanceM !== null || typeof body.distanceKilometers !== "number" || !Number.isFinite(body.distanceKilometers) || body.distanceKilometers <= 0) return null;
    distanceM = Math.round(body.distanceKilometers * 1000);
  }
  const notes = body.notes == null || body.notes === "" ? null : body.notes;
  if (notes != null && typeof notes !== "string") return null;
  const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId : null;
  return {
    workout: {
      type: body.type,
      occurredOn,
      durationMin: durationMin as number,
      intensity,
      distanceM,
      notes,
      clientRequestId,
    },
    distanceM,
    clientRequestId,
  };
}

function ledgerInserts(
  db: D1Database,
  session: PlayerSession,
  workoutId: string,
  ruleId: string,
  transactions: { kind: string; pointsTenths: number; reasonCode: string }[],
  now: number,
) {
  return transactions.map((row) => db.prepare(
    `INSERT INTO point_transactions (
      id, club_id, player_profile_id, workout_id, rule_version_id, kind, points_tenths, reason_code, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    CLUB_ID,
    session.profile_id,
    workoutId,
    ruleId,
    row.kind,
    row.pointsTenths,
    row.reasonCode,
    session.user_id,
    now,
  ));
}

function reversalInsert(db: D1Database, session: PlayerSession, workoutId: string, ruleId: string, net: number, now: number) {
  const reversal = planReversal(net);
  return ledgerInserts(db, session, workoutId, ruleId, [reversal], now);
}

function audit(db: D1Database, userId: string, action: string, entityId: string, before: unknown, after: unknown, now: number) {
  return db.prepare(
    `INSERT INTO audit_events (id, club_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, 'workout', ?, ?, json_set(?,'$.awardedPointsTenths',(SELECT COALESCE(SUM(points_tenths),0) FROM point_transactions WHERE workout_id=?)), ?)`,
  ).bind(
    crypto.randomUUID(),
    CLUB_ID,
    userId,
    action,
    entityId,
    before === null ? null : JSON.stringify(before),
    JSON.stringify(after),
    entityId,
    now,
  );
}


async function ownWorkout(db: D1Database, id: string, profileId: string): Promise<{ id: string; rule_version_id: string | null; occurred_on: string; scoring_revision: number; net_points: number } | null> {
  return db.prepare(
    "SELECT id,rule_version_id,occurred_on,scoring_revision, (SELECT COALESCE(SUM(points_tenths),0) FROM point_transactions WHERE workout_id=workouts.id) AS net_points FROM workouts WHERE id = ? AND player_profile_id = ? AND status = 'submitted'",
  ).bind(id, profileId).first<{ id: string; rule_version_id: string | null; occurred_on: string; scoring_revision: number; net_points: number }>();
}

type HistoryCursor = [date: string, createdAt: number, id: string];
function parseHistoryCursor(raw: string | undefined): HistoryCursor | null | false {
  if (raw === undefined) return null;
  if (raw.length > 256) return false;
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.length !== 3 || typeof value[0] !== "string" || !isRealCivilDate(value[0]) ||
        !Number.isSafeInteger(value[1]) || value[1] < 0 || typeof value[2] !== "string" || !value[2] || value[2].length > 100) return false;
    return value as HistoryCursor;
  } catch { return false; }
}

async function historyPage(db: D1Database, profileId: string, limit: number, cursor: HistoryCursor | null, counted: boolean) {
  const where = ["player_profile_id = ?"];
  const bindings: (string | number)[] = [profileId];
  if (counted) where.push("status IN ('submitted','approved')");
  if (cursor) {
    where.push("(occurred_on,created_at,id) < (?,?,?)");
    bindings.push(...cursor);
  }
  const rows = await db.prepare(
    `WITH page AS (
       SELECT id,type,occurred_on,duration_min,intensity,distance_m,notes,status,review_note,created_at,rule_version_id,calories,calorie_source
       FROM workouts WHERE ${where.join(" AND ")}
       ORDER BY occurred_on DESC,created_at DESC,id DESC LIMIT ?
     )
     SELECT w.id,w.type,COALESCE(json_extract(r.config_json,'$.types.' || w.type || '.label'),replace(w.type,'_',' ')) AS activity_label,
       w.occurred_on,w.duration_min,w.intensity,w.distance_m,w.notes,w.status,w.review_note,w.created_at,
       ${metricColumns},
       (SELECT COALESCE(SUM(t.points_tenths),0) FROM point_transactions t WHERE t.workout_id=w.id) AS points_tenths
     FROM page w LEFT JOIN scoring_rule_versions r ON r.id=w.rule_version_id
     ORDER BY w.occurred_on DESC,w.created_at DESC,w.id DESC`,
  ).bind(...bindings, limit + 1).all<WorkoutRow>();
  const workouts = rows.results.slice(0, limit).map(presentWorkout);
  const last = workouts.at(-1);
  return { workouts, nextCursor: rows.results.length > limit && last
    ? JSON.stringify([last.occurred_on, last.created_at, last.id]) : null };
}

function workoutStatement(db: D1Database, id: string, profileId: string) {
  return db.prepare(
    `SELECT w.id,w.type,COALESCE(json_extract(r.config_json,'$.types.' || w.type || '.label'),replace(w.type,'_',' ')) AS activity_label,
       w.occurred_on,w.duration_min,w.intensity,w.distance_m,w.notes,w.status,w.review_note,w.created_at,
       ${metricColumns},
       (SELECT COALESCE(SUM(t.points_tenths),0) FROM point_transactions t WHERE t.workout_id=w.id) AS points_tenths
     FROM workouts w LEFT JOIN scoring_rule_versions r ON r.id=w.rule_version_id
     WHERE w.player_profile_id=? AND w.id=?`,
  ).bind(profileId, id);
}

async function workoutPayload(db: D1Database, id: string, profileId: string, extra?: { idempotent: boolean }) {
  const row = await workoutStatement(db, id, profileId).first<WorkoutRow>();
  return { workout: row ? presentWorkout(row) : null, idempotent: extra?.idempotent ?? false };
}

function presentWorkout(row: WorkoutRow) {
  const { exercises_json, ...workout } = row;
  return {
    ...workout,
    exercises: JSON.parse(exercises_json || "[]") as Lift[],
    pace_seconds_per_km: row.distance_m ? Math.round(row.duration_min * 60000 / row.distance_m) : null,
    points_tenths: Number(row.points_tenths),
    distance_miles: row.distance_m == null ? null : metersToMiles(row.distance_m),
  };
}

async function readBody(c: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}
