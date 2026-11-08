import type { Context, Hono } from "hono";
import { clubCatalog } from "@blackthorn/db/catalog";
import { civilDateInTimeZone, isRealCivilDate } from "@blackthorn/scoring";
import type { Env } from "./app";
import { syncBadges } from "./badges";
import { challengeStandings, displayValue, isComplete, measure, parseRule, type ChallengeMetric, type ChallengeRule } from "./challenge-math";
import { loadProgress, transitionChallenges } from "./jobs";

const CLUB_ID = clubCatalog.id;
type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

interface MemberSession {
  user_id: string;
  role: string;
  profile_id: string | null;
}

export function registerEngageRoutes(
  app: Hono<AppEnv>,
  currentSession: (c: AppContext) => Promise<MemberSession | null>,
): void {
  app.get("/api/badges", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    if (session.profile_id) await syncBadges(c.env, session.profile_id);
    const rows = await c.env.DB.prepare(
      `SELECT a.key, a.name, a.description, pa.awarded_at
       FROM achievements a
       LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_profile_id = ?
       WHERE a.club_id = ?
       ORDER BY a.name`,
    ).bind(session.profile_id, CLUB_ID).all();
    return c.json({ badges: rows.results });
  });

  app.get("/api/notifications", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const rows = await c.env.DB.prepare(
      `SELECT id, kind, title, body, read_at, created_at
       FROM notifications WHERE club_id = ? AND user_id = ?
       ORDER BY created_at DESC LIMIT 50`,
    ).bind(CLUB_ID, session.user_id).all();
    const unread = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE club_id = ? AND user_id = ? AND read_at IS NULL",
    ).bind(CLUB_ID, session.user_id).first<{ n: number }>();
    return c.json({ notifications: rows.results, unread: Number(unread?.n ?? 0) });
  });

  app.post("/api/notifications/:id/read", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const result = await c.env.DB.prepare(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND club_id = ? AND read_at IS NULL",
    ).bind(Date.now(), c.req.param("id"), session.user_id, CLUB_ID).run();
    if ((result.meta.changes ?? 0) !== 1) {
      const owned = await c.env.DB.prepare(
        "SELECT id FROM notifications WHERE id = ? AND user_id = ? AND club_id = ?",
      ).bind(c.req.param("id"), session.user_id, CLUB_ID).first();
      if (!owned) return c.json({ error: "Notification not found." }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/api/notifications/read-all", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    await c.env.DB.prepare(
      "UPDATE notifications SET read_at = ? WHERE club_id = ? AND user_id = ? AND read_at IS NULL",
    ).bind(Date.now(), CLUB_ID, session.user_id).run();
    return c.json({ ok: true });
  });

  app.patch("/api/me/notifications", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const body = await readJson(c);
    if (typeof body?.emailNotifications !== "boolean") return c.json({ error: "Choose email on or off." }, 400);
    await c.env.DB.prepare("UPDATE users SET email_notifications = ?, updated_at = ? WHERE id = ?").bind(
      body.emailNotifications ? 1 : 0,
      Date.now(),
      session.user_id,
    ).run();
    return c.json({ ok: true, emailNotifications: body.emailNotifications });
  });

  app.get("/api/challenges", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const today = civilDateInTimeZone(new Date(), clubCatalog.timezone);
    await transitionChallenges(c.env, today, Date.now());
    const rows = await c.env.DB.prepare(
      `SELECT id, title, description, start_on, end_on, rule_json, status
       FROM challenges WHERE club_id = ? AND status IN ('published', 'archived')
       ORDER BY start_on DESC LIMIT 30`,
    ).bind(CLUB_ID).all<{ id: string; title: string; description: string; start_on: string; end_on: string; rule_json: string; status: string }>();
    const challenges = [];
    for (const row of rows.results) {
      const rule = parseRule(row.rule_json);
      if (!rule) continue;
      const progress = await loadProgress(c.env.DB, row.start_on, row.end_on);
      const standings = challengeStandings(rule, progress);
      const mine = session.profile_id ? progress.find((entry) => entry.profileId === session.profile_id) : undefined;
      const mineValue = mine ? measure(rule.metric, mine) : 0;
      challenges.push({
        id: row.id,
        title: row.title,
        description: row.description,
        startOn: row.start_on,
        endOn: row.end_on,
        status: row.status,
        scope: rule.scope,
        metric: rule.metric,
        target: rule.target,
        groupId: rule.groupId,
        summary: standings.summary,
        leaders: standings.leaders.slice(0, 8).map(presentStanding),
        sides: standings.sides.map(presentStanding),
        mine: mine
          ? { display: displayValue(rule.metric, mineValue), complete: isComplete(rule.metric, mineValue, rule.target) }
          : null,
        closed: today > row.end_on,
      });
    }
    return c.json({ today, challenges });
  });

  app.post("/api/challenges", async (c) => {
    const session = await requireStaff(c, currentSession);
    if (session instanceof Response) return session;
    const body = await readJson(c);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const startOn = typeof body?.startOn === "string" ? body.startOn : "";
    const endOn = typeof body?.endOn === "string" ? body.endOn : "";
    const scope = body?.scope === "group" ? "group" : body?.scope === "individual" ? "individual" : "";
    const metric = typeof body?.metric === "string" ? body.metric : "";
    const target = Number(body?.target);
    const groupId = typeof body?.groupId === "string" && body.groupId ? body.groupId : null;
    if (title.length < 3 || title.length > 80) return c.json({ error: "Enter a title." }, 400);
    if (description.length > 400) return c.json({ error: "Shorten the description." }, 400);
    if (!isRealCivilDate(startOn) || !isRealCivilDate(endOn) || startOn > endOn) return c.json({ error: "Check the dates." }, 400);
    if (scope !== "individual" && scope !== "group") return c.json({ error: "Choose who the challenge is for." }, 400);
    if (!isMetric(metric) || !(target > 0)) return c.json({ error: "Choose a metric and a target." }, 400);
    if (groupId) {
      const group = await c.env.DB.prepare("SELECT id FROM groups WHERE id = ? AND club_id = ?").bind(groupId, CLUB_ID).first();
      if (!group) return c.json({ error: "Choose a group." }, 400);
    }
    const rule: ChallengeRule = { scope, metric, target, groupId };
    const now = Date.now();
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO challenges (id, club_id, title, description, start_on, end_on, rule_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
    ).bind(id, CLUB_ID, title, description, startOn, endOn, JSON.stringify(rule), session.user_id, now, now).run();
    await c.env.DB.prepare(
      `INSERT INTO audit_events (id, club_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES (?, ?, ?, 'challenge_created', 'challenge', ?, NULL, ?, ?)`,
    ).bind(crypto.randomUUID(), CLUB_ID, session.user_id, id, JSON.stringify(rule), now).run();
    await transitionChallenges(c.env, civilDateInTimeZone(new Date(), clubCatalog.timezone), now);
    return c.json({ ok: true, id }, 201);
  });
}

function presentStanding(row: { name: string; display: string; complete: boolean }) {
  return { name: row.name, display: row.display, complete: row.complete };
}

function isMetric(value: string): value is ChallengeMetric {
  return value === "points" || value === "minutes" || value === "miles" || value === "sessions";
}

async function requireStaff(c: AppContext, currentSession: (c: AppContext) => Promise<MemberSession | null>): Promise<MemberSession | Response> {
  const session = await currentSession(c);
  if (!session) return c.json({ error: "Sign in required." }, 401);
  if (session.role !== "coach" && session.role !== "admin") return c.json({ error: "Coaches only." }, 403);
  return session;
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
