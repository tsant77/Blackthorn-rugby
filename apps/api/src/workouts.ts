import type { Context, Hono } from "hono";
import {
  addDays,
  assertClientCannotSetPoints,
  civilDateInTimeZone,
  ClientPointsError,
  metersToMiles,
  milesToMeters,
  planReversal,
  scoreWorkout,
  type Intensity,
  type PriorWorkout,
  type ScoringRule,
} from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";

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
  occurred_on: string;
  duration_min: number;
  intensity: string | null;
  distance_m: number | null;
  notes: string | null;
  status: string;
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
    const context = await scoringContext(c.env.DB);
    const workouts = await listOwn(c.env.DB, session.profile_id);
    return c.json({ today: context.today, minDate: context.minDate, workouts });
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
    const context = await scoringContext(c.env.DB);
    const draft = draftFromBody(body, context.today);
    if (!draft) return c.json({ error: "Check the duration, type, and date." }, 400);
    const existing = draft.clientRequestId
      ? await c.env.DB.prepare(
        "SELECT id FROM workouts WHERE player_profile_id = ? AND client_request_id = ? AND status != 'voided'",
      ).bind(session.profile_id, draft.clientRequestId).first<{ id: string }>()
      : null;
    if (existing) return c.json(await workoutPayload(c.env.DB, existing.id, session.profile_id!, { idempotent: true }));

    const decision = scoreWorkout({
      workout: draft.workout,
      athlete: athleteOf(session),
      rule: context.rule,
      history: await loadHistory(c.env.DB, session.profile_id!, draft.workout.occurredOn, null),
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
      ...ledgerInserts(c.env.DB, session, id, context.ruleId, decision.transactions, now),
      audit(c.env.DB, session.user_id, "workout_logged", id, null, { awardedPointsTenths: decision.awardedPointsTenths }, now),
    ];
    await c.env.DB.batch(statements);
    return c.json({
      ...(await workoutPayload(c.env.DB, id, session.profile_id!)),
      awardedPointsTenths: decision.awardedPointsTenths,
      grossPointsTenths: decision.grossPointsTenths,
      flags: decision.flags,
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
    const context = await scoringContext(c.env.DB);
    const draft = draftFromBody(body, context.today);
    if (!draft) return c.json({ error: "Check the duration, type, and date." }, 400);
    const decision = scoreWorkout({
      workout: { ...draft.workout, clientRequestId: null },
      athlete: athleteOf(session),
      rule: context.rule,
      history: await loadHistory(c.env.DB, session.profile_id!, draft.workout.occurredOn, owned.id),
      now: new Date(),
      timeZone: context.timeZone,
      offseasonStart: context.offseasonStart,
      offseasonEnd: context.offseasonEnd,
    });
    if (decision.outcome !== "award") return c.json({ error: decision.message, code: decision.rejectCode }, 400);
    const now = Date.now();
    const net = await netPoints(c.env.DB, owned.id);
    const statements = [
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
        context.ruleId,
        now,
        owned.id,
      ),
      ...reversalInsert(c.env.DB, session, owned.id, context.ruleId, net, now),
      ...ledgerInserts(c.env.DB, session, owned.id, context.ruleId, decision.transactions, now),
      audit(c.env.DB, session.user_id, "workout_edited", owned.id, { netPointsTenths: net }, { awardedPointsTenths: decision.awardedPointsTenths }, now),
    ];
    await c.env.DB.batch(statements);
    return c.json({
      ...(await workoutPayload(c.env.DB, owned.id, session.profile_id!)),
      awardedPointsTenths: decision.awardedPointsTenths,
      flags: decision.flags,
    });
  });

  app.delete("/api/workouts/:id", async (c) => {
    const session = await requirePlayer(c, currentSession);
    if (session instanceof Response) return session;
    const owned = await ownWorkout(c.env.DB, c.req.param("id"), session.profile_id!);
    if (!owned) return c.json({ error: "Workout not found." }, 404);
    const context = await scoringContext(c.env.DB);
    const now = Date.now();
    const net = await netPoints(c.env.DB, owned.id);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE workouts SET status = 'voided', updated_at = ? WHERE id = ?").bind(now, owned.id),
      ...reversalInsert(c.env.DB, session, owned.id, context.ruleId, net, now),
      audit(c.env.DB, session.user_id, "workout_deleted", owned.id, { netPointsTenths: net }, { status: "voided" }, now),
    ]);
    return c.json({ ok: true });
  });

  app.get("/api/leaderboard", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const context = await scoringContext(c.env.DB);
    const period = c.req.query("period") === "week" ? "week" : "offseason";
    const range = period === "week" ? context.week : { start: context.offseasonStart, end: context.offseasonEnd };
    const groupId = c.req.query("groupId") || null;
    const positionId = c.req.query("positionId") || null;
    const rows = await c.env.DB.prepare(
      `SELECT pr.id AS profile_id, pr.roster_name, pos.id AS position_id, pos.name AS position_name,
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
       WHERE (? IS NULL OR g.id = ?) AND (? IS NULL OR pos.id = ?)
       GROUP BY pr.id, pr.roster_name, pos.id, pos.name, g.id, g.name
       ORDER BY points_tenths DESC, pr.roster_name ASC`,
    ).bind(CLUB_ID, CLUB_ID, range.start, range.end, groupId, groupId, positionId, positionId).all<{
      profile_id: string;
      roster_name: string;
      position_id: string | null;
      position_name: string | null;
      group_id: string | null;
      group_name: string | null;
      points_tenths: number;
      workout_count: number;
    }>();
    let rank = 0;
    let previous: number | null = null;
    const standings = rows.results.map((row, index) => {
      if (previous !== row.points_tenths) rank = index + 1;
      previous = row.points_tenths;
      return { rank, ...row, points_tenths: Number(row.points_tenths), workout_count: Number(row.workout_count) };
    });
    return c.json({
      period,
      start: range.start,
      end: range.end,
      today: context.today,
      standings,
    });
  });

  app.get("/api/activity", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const rows = await c.env.DB.prepare(
      `SELECT w.id, w.type, w.occurred_on, w.duration_min, pr.roster_name,
              COALESCE(SUM(t.points_tenths), 0) AS points_tenths
       FROM workouts w
       JOIN player_profiles pr ON pr.id = w.player_profile_id
       JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ?
       LEFT JOIN point_transactions t ON t.workout_id = w.id
       WHERE w.status IN ('submitted', 'approved')
       GROUP BY w.id, w.type, w.occurred_on, w.duration_min, pr.roster_name, w.created_at
       ORDER BY w.created_at DESC
       LIMIT 20`,
    ).bind(CLUB_ID).all();
    return c.json({ activity: rows.results });
  });
}

async function requirePlayer(
  c: AppContext,
  currentSession: (c: AppContext) => Promise<PlayerSession | null>,
): Promise<PlayerSession | Response> {
  const session = await currentSession(c);
  if (!session) return c.json({ error: "Sign in required." }, 401);
  if (session.role !== "player" || !session.profile_id) {
    return c.json({ error: "Only players with a profile can log workouts." }, 403);
  }
  return session;
}

function athleteOf(session: PlayerSession): { injuryStatus: "available" | "limited" | "out"; trainingLocked: boolean } {
  const injuryStatus = session.injury_status === "limited" || session.injury_status === "out"
    ? session.injury_status
    : "available";
  return { injuryStatus, trainingLocked: session.training_locked === 1 };
}

async function scoringContext(db: D1Database) {
  const club = await db.prepare("SELECT timezone FROM clubs WHERE id = ?").bind(CLUB_ID).first<{ timezone: string }>();
  const timeZone = club?.timezone ?? "America/New_York";
  const today = civilDateInTimeZone(new Date(), timeZone);
  const ruleRow = await db.prepare(
    "SELECT id, version, status, config_json, backdate_days FROM scoring_rule_versions WHERE club_id = ? AND status = 'active'",
  ).bind(CLUB_ID).first<{ id: string; version: number; status: string; config_json: string; backdate_days: number }>();
  if (!ruleRow) throw new Error("No active scoring rule.");
  const parsed = JSON.parse(ruleRow.config_json) as ScoringRule;
  const rule: ScoringRule = { ...parsed, version: ruleRow.version, status: "active" };
  const period = await db.prepare(
    "SELECT start_on, end_on FROM competition_periods WHERE club_id = ? AND kind = 'offseason' AND status = 'active'",
  ).bind(CLUB_ID).first<{ start_on: string; end_on: string }>();
  const weekday = utcWeekday(today);
  return {
    timeZone,
    today,
    minDate: addDays(today, -rule.backdateDays),
    rule,
    ruleId: ruleRow.id,
    offseasonStart: period?.start_on ?? null,
    offseasonEnd: period?.end_on ?? null,
    week: { start: addDays(today, -weekday), end: addDays(today, 6 - weekday) },
  };
}

function utcWeekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (date.getUTCDay() + 6) % 7;
}

async function loadHistory(db: D1Database, profileId: string, occurredOn: string, excludeId: string | null): Promise<PriorWorkout[]> {
  const rows = await db.prepare(
    `SELECT w.id, w.type, w.occurred_on, w.started_at, w.ended_at, w.duration_min, w.intensity, w.status,
            w.client_request_id, COALESCE(SUM(t.points_tenths), 0) AS awarded
     FROM workouts w
     LEFT JOIN point_transactions t ON t.workout_id = w.id
     WHERE w.player_profile_id = ? AND w.status IN ('submitted', 'approved')
       AND w.occurred_on >= ? AND w.occurred_on <= ?
       AND (? IS NULL OR w.id != ?)
     GROUP BY w.id, w.type, w.occurred_on, w.started_at, w.ended_at, w.duration_min, w.intensity, w.status, w.client_request_id`,
  ).bind(profileId, addDays(occurredOn, -6), addDays(occurredOn, 6), excludeId, excludeId).all<{
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
  }>();
  return rows.results.map((row) => ({
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
  if (net === 0) return [];
  const reversal = planReversal(net);
  return ledgerInserts(db, session, workoutId, ruleId, [reversal], now);
}

function audit(db: D1Database, userId: string, action: string, entityId: string, before: unknown, after: unknown, now: number) {
  return db.prepare(
    `INSERT INTO audit_events (id, club_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, 'workout', ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    CLUB_ID,
    userId,
    action,
    entityId,
    before === null ? null : JSON.stringify(before),
    JSON.stringify(after),
    now,
  );
}

async function netPoints(db: D1Database, workoutId: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(points_tenths), 0) AS net FROM point_transactions WHERE workout_id = ?").bind(workoutId).first<{ net: number }>();
  return Number(row?.net ?? 0);
}

async function ownWorkout(db: D1Database, id: string, profileId: string): Promise<{ id: string } | null> {
  return db.prepare(
    "SELECT id FROM workouts WHERE id = ? AND player_profile_id = ? AND status != 'voided'",
  ).bind(id, profileId).first<{ id: string }>();
}

async function listOwn(db: D1Database, profileId: string): Promise<WorkoutRow[]> {
  const rows = await db.prepare(
    `SELECT w.id, w.type, w.occurred_on, w.duration_min, w.intensity, w.distance_m, w.notes, w.status, w.created_at,
            COALESCE(SUM(t.points_tenths), 0) AS points_tenths
     FROM workouts w
     LEFT JOIN point_transactions t ON t.workout_id = w.id
     WHERE w.player_profile_id = ? AND w.status != 'voided'
     GROUP BY w.id, w.type, w.occurred_on, w.duration_min, w.intensity, w.distance_m, w.notes, w.status, w.created_at
     ORDER BY w.occurred_on DESC, w.created_at DESC`,
  ).bind(profileId).all<WorkoutRow>();
  return rows.results.map(presentWorkout);
}

async function workoutPayload(db: D1Database, id: string, profileId: string, extra?: { idempotent: boolean }) {
  const rows = await listOwn(db, profileId);
  const workout = rows.find((row) => row.id === id) ?? null;
  return { workout, idempotent: extra?.idempotent ?? false };
}

function presentWorkout(row: WorkoutRow): WorkoutRow & { distance_miles: number | null } {
  return {
    ...row,
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
