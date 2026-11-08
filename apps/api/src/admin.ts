import type { Context, Hono } from "hono";
import { clubCatalog } from "@blackthorn/db/catalog";
import { isRealCivilDate } from "@blackthorn/scoring";
import type { Env } from "./app";
import { scoringContext } from "./workouts";
import { syncBadges } from "./badges";
import { notifyReview } from "./notify";

const CLUB_ID = clubCatalog.id;
type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

interface StaffSession {
  user_id: string;
  role: string;
  membership_id: string;
}

export function registerAdminRoutes(
  app: Hono<AppEnv>,
  currentSession: (c: AppContext) => Promise<StaffSession | null>,
): void {
  app.get("/api/moderation", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    const rows = await c.env.DB.prepare(
      `SELECT w.id, w.type, w.occurred_on, w.duration_min, w.status, w.review_note, w.created_at,
              pr.roster_name, COALESCE(SUM(t.points_tenths), 0) AS points_tenths
       FROM workouts w
       JOIN player_profiles pr ON pr.id = w.player_profile_id
       JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ?
       LEFT JOIN point_transactions t ON t.workout_id = w.id
       GROUP BY w.id, w.type, w.occurred_on, w.duration_min, w.status, w.review_note, w.created_at, pr.roster_name
       ORDER BY w.created_at DESC
       LIMIT 40`,
    ).bind(CLUB_ID).all();
    return c.json({ workouts: rows.results });
  });

  app.post("/api/moderation/:id", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    const body = await readJson(c);
    const action = body?.action;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (action !== "reject" && action !== "void" && action !== "restore") {
      return c.json({ error: "Choose reject, void, or restore." }, 400);
    }
    if (action !== "restore" && (reason.length < 3 || reason.length > 200)) {
      return c.json({ error: "Add a short reason." }, 400);
    }
    const workout = await c.env.DB.prepare(
      `SELECT w.id, w.status, w.player_profile_id, w.rule_version_id
       FROM workouts w
       JOIN player_profiles pr ON pr.id = w.player_profile_id
       JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ?
       WHERE w.id = ?`,
    ).bind(CLUB_ID, c.req.param("id")).first<{ id: string; status: string; player_profile_id: string; rule_version_id: string }>();
    if (!workout) return c.json({ error: "Workout not found." }, 404);
    const now = Date.now();
    const net = await netPoints(c.env.DB, workout.id);
    if (action === "restore") {
      if (workout.status === "submitted" || workout.status === "approved") {
        return c.json({ error: "That workout is already active." }, 409);
      }
      const reversed = await c.env.DB.prepare(
        `SELECT points_tenths FROM point_transactions
         WHERE workout_id = ? AND kind = 'reversal' ORDER BY created_at DESC LIMIT 1`,
      ).bind(workout.id).first<{ points_tenths: number }>();
      const restore = reversed ? -Number(reversed.points_tenths) : 0;
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE workouts SET status = 'submitted', review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
        ).bind(reason || "Restored", session.user_id, now, now, workout.id),
        ...(restore === 0 ? [] : [ledger(c.env.DB, workout, session.user_id, restore, "adjustment", "restore", reason || "Restored", now)]),
        audit(c.env.DB, session.user_id, "workout_restored", workout.id, { status: workout.status }, { status: "submitted", reason }, now),
      ]);
      await notifyReview(c.env, workout.id, "restore", reason || "Restored", now);
      await syncBadges(c.env, workout.player_profile_id, now);
      return c.json({ ok: true });
    }
    if (workout.status !== "submitted" && workout.status !== "approved") {
      return c.json({ error: "That workout is already closed." }, 409);
    }
    const status = action === "reject" ? "rejected" : "voided";
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE workouts SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
      ).bind(status, reason, session.user_id, now, now, workout.id),
      ...(net === 0 ? [] : [ledger(c.env.DB, workout, session.user_id, -net, "reversal", action, reason, now)]),
      audit(c.env.DB, session.user_id, `workout_${action}`, workout.id, { netPointsTenths: net }, { status, reason }, now),
    ]);
    await notifyReview(c.env, workout.id, action, reason, now);
    await syncBadges(c.env, workout.player_profile_id, now);
    return c.json({ ok: true });
  });

  app.get("/api/members", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    const members = await c.env.DB.prepare(
      `SELECT m.id AS membership_id, m.role, m.status, u.id AS user_id, '' AS email, u.name, u.status AS user_status,
              pr.id AS profile_id, pr.roster_name, pr.position_id, pr.group_id, pr.injury_status, pr.injury_note,
              pos.name AS position_name, g.name AS group_name
       FROM club_memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN player_profiles pr ON pr.membership_id = m.id
       LEFT JOIN positions pos ON pos.id = pr.position_id
       LEFT JOIN groups g ON g.id = pr.group_id
       WHERE m.club_id = ?
       ORDER BY m.status, u.name`,
    ).bind(CLUB_ID).all();
    return c.json({ members: members.results, invitations: [] });
  });

  app.post("/api/invitations/:id/resend", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    return c.json({ error: "Email invitations are no longer available. Create a new invitation link." }, 410);
  });

  app.post("/api/invitations/:id/revoke", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const now = Date.now();
    const result = await c.env.DB.prepare(
      "UPDATE invitations SET expires_at = ? WHERE id = ? AND club_id = ? AND accepted_at IS NULL AND expires_at > ?",
    ).bind(now, c.req.param("id"), CLUB_ID, now).run();
    if ((result.meta.changes ?? 0) !== 1) return c.json({ error: "Invite not found." }, 404);
    await runAudit(c.env.DB, session.user_id, "invite_revoked", "invitation", c.req.param("id"), null, null, now);
    return c.json({ ok: true });
  });

  app.patch("/api/members/:id", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const body = await readJson(c);
    const role = body?.role;
    const status = body?.status;
    if (role != null && role !== "player" && role !== "coach" && role !== "admin") {
      return c.json({ error: "Choose a role." }, 400);
    }
    if (status != null && status !== "active" && status !== "deactivated") {
      return c.json({ error: "Choose a status." }, 400);
    }
    const member = await c.env.DB.prepare(
      "SELECT id, user_id, role, status FROM club_memberships WHERE id = ? AND club_id = ?",
    ).bind(c.req.param("id"), CLUB_ID).first<{ id: string; user_id: string; role: string; status: string }>();
    if (!member) return c.json({ error: "Member not found." }, 404);
    const nextRole = typeof role === "string" ? role : member.role;
    const nextStatus = typeof status === "string" ? status : member.status;
    if (body?.approve === true) {
      const now = Date.now();
      await c.env.DB.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").bind(now, member.user_id).run();
      await runAudit(c.env.DB, session.user_id, "member_approved", "club_membership", member.id, null, { userId: member.user_id }, now);
      return c.json({ ok: true });
    }
    if ((member.role === "admin" && member.status === "active") && (nextRole !== "admin" || nextStatus !== "active")) {
      const admins = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM club_memberships WHERE club_id = ? AND role = 'admin' AND status = 'active'",
      ).bind(CLUB_ID).first<{ n: number }>();
      if ((admins?.n ?? 0) <= 1) return c.json({ error: "The club needs one active admin." }, 409);
    }
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE club_memberships SET role=?,status=?,updated_at=? WHERE id=?")
        .bind(nextRole, nextStatus, now, member.id),
      ...(nextStatus === "deactivated" || nextRole !== member.role ? [
        c.env.DB.prepare("DELETE FROM player_login_links WHERE user_id=?").bind(member.user_id),
        c.env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, member.user_id),
        c.env.DB.prepare("UPDATE access_links SET enabled=0 WHERE user_id=? AND kind='signin'").bind(member.user_id),
        c.env.DB.prepare("UPDATE password_resets SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL").bind(now, member.user_id),
        c.env.DB.prepare("UPDATE magic_links SET consumed_at=? WHERE email=(SELECT email FROM users WHERE id=?) AND consumed_at IS NULL").bind(now, member.user_id),
      ] : []),
    ]);
    await runAudit(c.env.DB, session.user_id, "member_updated", "club_membership", member.id, member, { role: nextRole, status: nextStatus }, now);
    return c.json({ ok: true });
  });

  app.patch("/api/profiles/:id", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    const body = await readJson(c);
    const profile = await c.env.DB.prepare(
      `SELECT pr.id, pr.position_id, pr.group_id, pr.injury_status, pr.injury_note, pr.roster_name
       FROM player_profiles pr
       JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ?
       WHERE pr.id = ?`,
    ).bind(CLUB_ID, c.req.param("id")).first<{ id: string; position_id: string | null; group_id: string | null; injury_status: string; injury_note: string | null; roster_name: string }>();
    if (!profile) return c.json({ error: "Profile not found." }, 404);
    let positionId = profile.position_id;
    let groupId = profile.group_id;
    if (body?.clearPosition === true) {
      positionId = null;
      groupId = null;
    } else if (typeof body?.positionId === "string" && body.positionId) {
      const position = await c.env.DB.prepare(
        "SELECT id, group_id FROM positions WHERE id = ? AND club_id = ?",
      ).bind(body.positionId, CLUB_ID).first<{ id: string; group_id: string }>();
      if (!position) return c.json({ error: "Choose a position." }, 400);
      positionId = position.id;
      groupId = position.group_id;
    }
    const injury = body?.injuryStatus;
    const injuryStatus = injury === "available" || injury === "limited" || injury === "out" ? injury : profile.injury_status;
    const injuryNote = typeof body?.injuryNote === "string" ? body.injuryNote.trim().slice(0, 200) : profile.injury_note;
    const rosterName = typeof body?.rosterName === "string" && body.rosterName.trim() ? body.rosterName.trim().slice(0, 40) : profile.roster_name;
    const now = Date.now();
    await c.env.DB.prepare(
      `UPDATE player_profiles SET roster_name = ?, position_id = ?, group_id = ?, injury_status = ?, injury_note = ?, updated_at = ? WHERE id = ?`,
    ).bind(rosterName, positionId, groupId, injuryStatus, injuryNote, now, profile.id).run();
    await runAudit(c.env.DB, session.user_id, "profile_updated", "player_profile", profile.id, profile, { positionId, groupId, injuryStatus, rosterName }, now);
    return c.json({ ok: true });
  });

  app.get("/api/rules", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    await scoringContext(c.env.DB);
    const rows = await c.env.DB.prepare(
      `SELECT id, version, status, daily_cap_tenths, session_cap_tenths, weekly_load_limit, effective_on, notes, created_at
       FROM scoring_rule_versions WHERE club_id = ? ORDER BY version DESC`,
    ).bind(CLUB_ID).all();
    return c.json({ rules: rows.results });
  });

  app.post("/api/rules", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const body = await readJson(c);
    const daily = Number(body?.dailyCapTenths);
    const sessionCap = Number(body?.sessionCapTenths);
    const weekly = Number(body?.weeklyLoadLimit);
    const effectiveOn = typeof body?.effectiveOn === "string" ? body.effectiveOn : "";
    if (!Number.isInteger(daily) || !Number.isInteger(sessionCap) || !Number.isInteger(weekly)) {
      return c.json({ error: "Caps must be whole numbers." }, 400);
    }
    if (!isRealCivilDate(effectiveOn)) return c.json({ error: "Choose an effective date." }, 400);
    const context = await scoringContext(c.env.DB);
    if (effectiveOn < context.today) return c.json({ error: "Effective date must be today or later." }, 400);
    const active = await c.env.DB.prepare(
      "SELECT id, version, config_json FROM scoring_rule_versions WHERE club_id = ? AND status = 'active'",
    ).bind(CLUB_ID).first<{ id: string; version: number; config_json: string }>();
    if (!active) return c.json({ error: "No active rule." }, 409);
    const config = JSON.parse(active.config_json) as { version: number; dailyCapTenths: number; sessionCapTenths: number; weeklyLoadLimit: number };
    const version = active.version + 1;
    config.version = version;
    config.dailyCapTenths = daily;
    config.sessionCapTenths = sessionCap;
    config.weeklyLoadLimit = weekly;
    const now = Date.now();
    const id = crypto.randomUUID();
    const activateNow = effectiveOn <= context.today;
    const statements = [];
    if (activateNow) {
      statements.push(c.env.DB.prepare(
        "UPDATE scoring_rule_versions SET status = 'retired', retired_at = ? WHERE club_id = ? AND status = 'active'",
      ).bind(now, CLUB_ID));
    }
    statements.push(c.env.DB.prepare(
      `INSERT INTO scoring_rule_versions (
        id, club_id, version, status, daily_cap_tenths, session_cap_tenths, weekly_load_limit, backdate_days,
        config_json, notes, effective_on, created_by, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, CLUB_ID, version, activateNow ? "active" : "draft", daily, sessionCap, weekly, context.rule.backdateDays,
      JSON.stringify(config), typeof body?.notes === "string" ? body.notes.slice(0, 200) : null, effectiveOn, session.user_id, now,
      activateNow ? now : null,
    ));
    await c.env.DB.batch(statements);
    await runAudit(c.env.DB, session.user_id, "rule_created", "scoring_rule_version", id, null, { version, effectiveOn, daily, sessionCap, weekly }, now);
    return c.json({ ok: true, id, status: activateNow ? "active" : "draft" }, 201);
  });

  app.post("/api/adjustments", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const body = await readJson(c);
    const pointsTenths = Number(body?.pointsTenths);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const occurredOn = typeof body?.occurredOn === "string" ? body.occurredOn : "";
    const profileId = typeof body?.profileId === "string" ? body.profileId : "";
    if (!Number.isInteger(pointsTenths) || pointsTenths === 0) return c.json({ error: "Enter a non-zero point adjustment in tenths." }, 400);
    if (reason.length < 3) return c.json({ error: "Add a reason." }, 400);
    if (!isRealCivilDate(occurredOn)) return c.json({ error: "Choose a date." }, 400);
    const profile = await c.env.DB.prepare(
      `SELECT pr.id FROM player_profiles pr JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ? WHERE pr.id = ?`,
    ).bind(CLUB_ID, profileId).first<{ id: string }>();
    if (!profile) return c.json({ error: "Profile not found." }, 404);
    const context = await scoringContext(c.env.DB);
    const now = Date.now();
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO point_transactions (
        id, club_id, player_profile_id, workout_id, rule_version_id, kind, points_tenths, reason_code, reason_detail, occurred_on, created_by, created_at
      ) VALUES (?, ?, ?, NULL, ?, 'adjustment', ?, 'adjustment', ?, ?, ?, ?)`,
    ).bind(id, CLUB_ID, profileId, context.ruleId, pointsTenths, reason, occurredOn, session.user_id, now).run();
    await runAudit(c.env.DB, session.user_id, "points_adjusted", "point_transaction", id, null, { profileId, pointsTenths, reason, occurredOn }, now);
    await syncBadges(c.env, profileId, now);
    return c.json({ ok: true }, 201);
  });

  app.get("/api/season", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    const row = await c.env.DB.prepare(
      "SELECT id, name, start_on, end_on, status FROM competition_periods WHERE club_id = ? AND kind = 'offseason' AND status = 'active'",
    ).bind(CLUB_ID).first();
    return c.json({ season: row });
  });

  app.patch("/api/season", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const body = await readJson(c);
    const startOn = typeof body?.startOn === "string" ? body.startOn : "";
    const endOn = typeof body?.endOn === "string" ? body.endOn : "";
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!isRealCivilDate(startOn) || !isRealCivilDate(endOn) || startOn > endOn || !name) {
      return c.json({ error: "Check the season name and dates." }, 400);
    }
    const current = await c.env.DB.prepare(
      "SELECT id, name, start_on, end_on FROM competition_periods WHERE club_id = ? AND kind = 'offseason' AND status = 'active'",
    ).bind(CLUB_ID).first<{ id: string; name: string; start_on: string; end_on: string }>();
    if (!current) return c.json({ error: "No active offseason." }, 404);
    const now = Date.now();
    await c.env.DB.prepare(
      "UPDATE competition_periods SET name = ?, start_on = ?, end_on = ?, updated_at = ? WHERE id = ?",
    ).bind(name, startOn, endOn, now, current.id).run();
    await runAudit(c.env.DB, session.user_id, "season_updated", "competition_period", current.id, current, { name, startOn, endOn }, now);
    return c.json({ ok: true });
  });

  app.get("/api/audit", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    const action = c.req.query("action") || null;
    const entityType = c.req.query("entityType") || null;
    const from = c.req.query("from") || null;
    const to = c.req.query("to") || null;
    const rows = await c.env.DB.prepare(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.before_json, a.after_json, a.created_at, u.email AS actor_email
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.club_id = ?
         AND (? IS NULL OR a.action = ?)
         AND (? IS NULL OR a.entity_type = ?)
         AND (? IS NULL OR a.created_at >= ?)
         AND (? IS NULL OR a.created_at <= ?)
       ORDER BY a.created_at DESC
       LIMIT 100`,
    ).bind(CLUB_ID, action, action, entityType, entityType, from, from ? Number(from) : null, to, to ? Number(to) : null).all();
    return c.json({ events: rows.results });
  });

  app.get("/api/export/workouts.csv", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    const workouts = await c.env.DB.prepare(
      `SELECT pr.roster_name, u.email, w.type, w.occurred_on, w.duration_min, w.distance_m, w.intensity, w.notes,
              w.status, w.review_note, COALESCE(SUM(t.points_tenths), 0) AS points_tenths
       FROM workouts w
       JOIN player_profiles pr ON pr.id = w.player_profile_id
       JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ?
       JOIN users u ON u.id = m.user_id
       LEFT JOIN point_transactions t ON t.workout_id = w.id
       GROUP BY w.id, pr.roster_name, u.email, w.type, w.occurred_on, w.duration_min, w.distance_m, w.intensity, w.notes, w.status, w.review_note
       ORDER BY w.occurred_on, pr.roster_name`,
    ).bind(CLUB_ID).all<Record<string, string | number | null>>();
    const adjustments = await c.env.DB.prepare(
      `SELECT pr.roster_name, u.email, t.occurred_on, t.points_tenths, t.reason_detail
       FROM point_transactions t
       JOIN player_profiles pr ON pr.id = t.player_profile_id
       JOIN club_memberships m ON m.id = pr.membership_id AND m.club_id = ?
       JOIN users u ON u.id = m.user_id
       WHERE t.workout_id IS NULL
       ORDER BY t.occurred_on, pr.roster_name`,
    ).bind(CLUB_ID).all<{ roster_name: string; email: string; occurred_on: string | null; points_tenths: number; reason_detail: string | null }>();
    const lines = ["row_type,roster_name,email,type,occurred_on,duration_min,distance_m,intensity,notes,status,review_note,points_tenths,reason"];
    for (const row of workouts.results) {
      lines.push([
        "workout", row.roster_name, row.email, row.type, row.occurred_on, row.duration_min, row.distance_m, row.intensity,
        row.notes, row.status, row.review_note, row.points_tenths, "",
      ].map(csv).join(","));
    }
    for (const row of adjustments.results) {
      lines.push(["adjustment", row.roster_name, row.email, "", row.occurred_on, "", "", "", "", "", "", row.points_tenths, row.reason_detail].map(csv).join(","));
    }
    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=\"blackthorn-workouts.csv\"",
      },
    });
  });
}

async function requireStaff(c: AppContext, currentSession: (c: AppContext) => Promise<StaffSession | null>): Promise<StaffSession | Response> {
  const session = await currentSession(c);
  if (!session) return c.json({ error: "Sign in required." }, 401);
  if (session.role !== "coach" && session.role !== "admin") return c.json({ error: "Coaches only." }, 403);
  return session;
}

async function requireAdmin(c: AppContext, currentSession: (c: AppContext) => Promise<StaffSession | null>): Promise<StaffSession | Response> {
  const session = await requireStaff(c, currentSession);
  if (session instanceof Response) return session;
  if (session.role !== "admin") return c.json({ error: "Admins only." }, 403);
  return session;
}

function ledger(db: D1Database, workout: { id: string; player_profile_id: string; rule_version_id: string }, userId: string, points: number, kind: string, reasonCode: string, detail: string, now: number) {
  return db.prepare(
    `INSERT INTO point_transactions (
      id, club_id, player_profile_id, workout_id, rule_version_id, kind, points_tenths, reason_code, reason_detail, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), CLUB_ID, workout.player_profile_id, workout.id, workout.rule_version_id, kind, points, reasonCode, detail, userId, now);
}

async function netPoints(db: D1Database, workoutId: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(points_tenths), 0) AS net FROM point_transactions WHERE workout_id = ?").bind(workoutId).first<{ net: number }>();
  return Number(row?.net ?? 0);
}

async function runAudit(db: D1Database, userId: string, action: string, entityType: string, entityId: string, before: unknown, after: unknown, now: number) {
  await db.prepare(
    `INSERT INTO audit_events (id, club_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), CLUB_ID, userId, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, now).run();
}

function audit(db: D1Database, userId: string, action: string, entityId: string, before: unknown, after: unknown, now: number) {
  return db.prepare(
    `INSERT INTO audit_events (id, club_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, 'workout', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), CLUB_ID, userId, action, entityId, before ? JSON.stringify(before) : null, JSON.stringify(after), now);
}

async function readJson(c: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function csv(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}
