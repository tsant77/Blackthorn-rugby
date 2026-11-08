import { registerAccountRoutes } from "./accounts";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SendEmail } from "@cloudflare/workers-types";
import { clubCatalog } from "@blackthorn/db/catalog";
import { cloudflareEmailProvider, consoleEmailProvider, renderMagicLink, type EmailProvider } from "./email";
import { randomToken, secretsEqual, sha256Hex } from "./tokens";
import { registerAdminRoutes } from "./admin";
import { registerEngageRoutes } from "./engage";
import { registerAnalyticsRoutes } from "./analytics";
import { registerWorkoutRoutes } from "./workouts";
import { emailEnabled, registerLinkRoutes } from "./links";

const CLUB_ID = clubCatalog.id;
const SESSION_COOKIE = "blackthorn_session";
const SESSION_MS = 180 * 24 * 60 * 60 * 1000;
const SESSION_SLIDE_MS = 90 * 24 * 60 * 60 * 1000;
const LOGIN_LINK_MS = 15 * 60 * 1000;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROSTER_RE = /^[\p{L}\p{M}0-9 .'-]+$/u;

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  EMAIL?: SendEmail;
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  APP_ORIGIN?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_TOKEN?: string;
  AUTH_EMAIL_LIMIT?: string;
  AUTH_IP_LIMIT?: string;
  AUTH_LINK_LIMIT?: string;
  AUTH_REDEEM_LIMIT?: string;
}

type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

interface SessionRow {
  user_id: string;
  email: string;
  name: string;
  user_status: string;
  membership_id: string;
  role: string;
  membership_status: string;
  club_id: string;
  profile_id: string | null;
  roster_name: string | null;
  position_id: string | null;
  group_id: string | null;
  injury_status: string | null;
  injury_note: string | null;
  training_locked: number | null;
  email_notifications: number;
  expires_at: number;
}

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const site = c.req.header("sec-fetch-site");
      if (site === "cross-site") return c.json({ error: "Cross-site request blocked." }, 403);
      const origin = c.req.header("origin");
      if (origin) {
        const self = new URL(c.req.url).origin;
        const configured = c.env.APP_ORIGIN?.replace(/\/$/, "");
        if (origin !== self && origin !== configured) return c.json({ error: "Cross-site request blocked." }, 403);
      }
    }
    await next();
    const headers = c.res.headers;
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    if (c.req.path.startsWith("/api/")) headers.set("cache-control", "no-store");
    headers.set("x-frame-options", "DENY");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    headers.set(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    if (new URL(c.req.url).protocol === "https:") {
      headers.set("strict-transport-security", "max-age=15552000; includeSubDomains");
    }
  });

  app.get("/health", (c) => c.json({ ok: true, service: "blackthorn-rugby" }));

  app.post("/api/auth/request", async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body?.email);
    if (!email) return c.json({ error: "Enter a valid email." }, 400);
    if (!emailEnabled(c.env)) return c.json({ error: "Email sign-in is off." }, 404);
    const now = Date.now();
    const ip = clientIp(c);
    if (!(await allowAttempt(c.env.DB, `ip:${ip}`, attemptLimit(c.env.AUTH_IP_LIMIT, 30), now))) {
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }
    if (!(await allowAttempt(c.env.DB, `email:${email}`, attemptLimit(c.env.AUTH_EMAIL_LIMIT, 5), now))) {
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }

    try {
      await maybeBootstrapAdmin(c.env, email, now);
      const member = await findActiveMember(c.env.DB, email);
      if (member) {
        await issueLoginLink(c.env, email, now);
      } else {
        await reissuePendingInvite(c.env, email, now);
      }
    } catch (error) {
      if (error instanceof EmailConfigError) {
        console.error(JSON.stringify({ event: "email_not_configured" }));
        return c.json({ error: "Email is not configured." }, 503);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  app.get("/auth/verify", async (c) => consumeLink(c, "login"));
  app.get("/auth/invite", async (c) => consumeLink(c, "invite"));

  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const hash = await sha256Hex(token);
      await c.env.DB.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      ).bind(Date.now(), hash).run();
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/me", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    return c.json(presentSession(session));
  });

  app.get("/api/roster-options", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const positions = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.group_id, g.name AS group_name
       FROM positions p JOIN groups g ON g.id = p.group_id
       WHERE p.club_id = ? ORDER BY p.sort_order`,
    ).bind(CLUB_ID).all<{ id: string; name: string; group_id: string; group_name: string }>();
    return c.json({ positions: positions.results });
  });

  app.post("/api/onboarding", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    if (session.profile_id) return c.json({ error: "Profile already exists." }, 409);
    const body = await readJson(c);
    const rosterName = normalizeRosterName(body?.rosterName);
    const positionId = typeof body?.positionId === "string" ? body.positionId : "";
    const injuryStatus = normalizeInjury(body?.injuryStatus) ?? "available";
    const injuryNote = normalizeNote(body?.injuryNote);
    if (!rosterName) return c.json({ error: "Enter the name you want on the roster." }, 400);
    const staff = session.role === "coach" || session.role === "admin";
    let position: { id: string; group_id: string } | null = null;
    if (positionId) {
      position = await c.env.DB.prepare(
        "SELECT id, group_id FROM positions WHERE id = ? AND club_id = ? AND group_id IS NOT NULL",
      ).bind(positionId, CLUB_ID).first<{ id: string; group_id: string }>();
      if (!position) return c.json({ error: "Choose a position." }, 400);
    } else if (!staff) {
      return c.json({ error: "Choose a position." }, 400);
    }
    const now = Date.now();
    const profileId = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO player_profiles (
          id, membership_id, roster_name, position_id, group_id, injury_status, training_locked, injury_note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).bind(profileId, session.membership_id, rosterName, position?.id ?? null, position?.group_id ?? null, injuryStatus, injuryNote, now, now),
      c.env.DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").bind(rosterName, now, session.user_id),
      audit(c.env.DB, session, "profile_created", "player_profile", profileId, null, {
        rosterName,
        positionId: position?.id ?? null,
        groupId: position?.group_id ?? null,
        injuryStatus,
      }, now),
    ]);
    return c.json({ ok: true });
  });

  app.patch("/api/me/injury", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    if (!session.profile_id) return c.json({ error: "Finish onboarding first." }, 409);
    const body = await readJson(c);
    const injuryStatus = normalizeInjury(body?.injuryStatus);
    if (!injuryStatus) return c.json({ error: "Choose an availability." }, 400);
    const injuryNote = normalizeNote(body?.injuryNote);
    await updateInjury(c, session, session.profile_id, injuryStatus, injuryNote);
    return c.json({ ok: true });
  });

  app.get("/api/squad", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    if (session.role === "player") return c.json({ error: "Coaches only." }, 403);
    const rows = await c.env.DB.prepare(
      `SELECT p.id, p.roster_name, p.injury_status, p.injury_note, pos.name AS position_name, g.name AS group_name
       FROM player_profiles p
       JOIN club_memberships m ON m.id = p.membership_id
       LEFT JOIN positions pos ON pos.id = p.position_id
       LEFT JOIN groups g ON g.id = p.group_id
       WHERE m.club_id = ? AND m.status = 'active'
       ORDER BY p.roster_name`,
    ).bind(CLUB_ID).all();
    return c.json({ players: rows.results });
  });

  app.patch("/api/squad/:profileId/injury", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    if (session.role === "player") return c.json({ error: "Coaches only." }, 403);
    const body = await readJson(c);
    const injuryStatus = normalizeInjury(body?.injuryStatus);
    if (!injuryStatus) return c.json({ error: "Choose an availability." }, 400);
    const injuryNote = normalizeNote(body?.injuryNote);
    const updated = await updateInjury(c, session, c.req.param("profileId"), injuryStatus, injuryNote);
    if (!updated) return c.json({ error: "Player not found." }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/invitations", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    if (session.role !== "admin") return c.json({ error: "Admins send invitations." }, 403);
    const body = await readJson(c);
    const email = normalizeEmail(body?.email);
    const role = body?.role;
    if (!email) return c.json({ error: "Enter a valid email." }, 400);
    if (role !== "player" && role !== "coach" && role !== "admin") {
      return c.json({ error: "Choose a role." }, 400);
    }
    const existing = await findActiveMember(c.env.DB, email);
    if (existing) return c.json({ error: "That person is already in the club." }, 409);
    const now = Date.now();
    try {
      await createInvitation(c.env, session, email, role, now);
    } catch (error) {
      if (error instanceof EmailConfigError) return c.json({ error: "Email is not configured." }, 503);
      throw error;
    }
    return c.json({ ok: true }, 201);
  });

  app.get("/api/dev/mailbox", async (c) => {
    if (c.env.EMAIL_PROVIDER !== "console") return c.json({ error: "Not found" }, 404);
    const to = normalizeEmail(c.req.query("to"));
    if (!to) return c.json({ error: "Missing recipient." }, 400);
    const rows = await c.env.DB.prepare(
      "SELECT to_address, subject, text_body, created_at FROM dev_mailbox WHERE to_address = ? ORDER BY created_at DESC LIMIT 5",
    ).bind(to).all();
    return c.json({ messages: rows.results });
  });

  registerWorkoutRoutes(app, currentSession);
  registerAnalyticsRoutes(app, currentSession);
  registerAdminRoutes(app, currentSession);
  registerEngageRoutes(app, currentSession);
  registerLinkRoutes(app, currentSession, startSession);
  registerAccountRoutes(app, currentSession, startSession);

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.all("/auth/*", (c) => c.redirect("/login?error=invalid"));

  app.all("*", async (c) => {
    if (!c.env.ASSETS) return c.json({ error: "Not found" }, 404);
    return c.env.ASSETS.fetch(c.req.raw);
  });

  return app;
}

const app = createApp();
export default app;

async function consumeLink(c: AppContext, kind: "login" | "invite"): Promise<Response> {
  const token = c.req.query("token") ?? "";
  if (!token) return c.redirect("/login?error=invalid");
  const hash = await sha256Hex(token);
  const now = Date.now();
  if (kind === "login") {
    const link = await c.env.DB.prepare(
      "SELECT id, email FROM magic_links WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    ).bind(hash, now).first<{ id: string; email: string }>();
    if (!link) return c.redirect("/login?error=expired");
    const consumed = await c.env.DB.prepare(
      "UPDATE magic_links SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
    ).bind(now, link.id).run();
    if ((consumed.meta.changes ?? 0) !== 1) return c.redirect("/login?error=expired");
    const member = await findActiveMember(c.env.DB, link.email);
    if (!member) return c.redirect("/login?error=expired");
    await startSession(c, member.user_id, now);
    const profile = await profileForUser(c.env.DB, member.user_id);
    return c.redirect(member.role === "player" && !profile ? "/onboarding" : "/");
  }

  const invite = await c.env.DB.prepare(
    "SELECT id, email, role FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?",
  ).bind(hash, now).first<{ id: string; email: string; role: string }>();
  if (!invite) return c.redirect("/login?error=expired");
  const consumed = await c.env.DB.prepare(
    "UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL",
  ).bind(now, invite.id).run();
  if ((consumed.meta.changes ?? 0) !== 1) return c.redirect("/login?error=expired");
  const userId = await ensureUser(c.env.DB, invite.email, now);
  await ensureMembership(c.env.DB, userId, invite.role, now);
  await c.env.DB.prepare(
    "INSERT INTO audit_events (id, club_id, actor_user_id, action, entity_type, entity_id, after_json, created_at) VALUES (?, ?, ?, 'invite_accepted', 'invitation', ?, ?, ?)",
  ).bind(crypto.randomUUID(), CLUB_ID, userId, invite.id, JSON.stringify({ email: invite.email, role: invite.role }), now).run();
  await startSession(c, userId, now);
  return c.redirect(invite.role === "player" ? "/onboarding" : "/");
}

async function issueLoginLink(env: Env, email: string, now: number): Promise<void> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    "INSERT INTO magic_links (id, email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), email, hash, now + LOGIN_LINK_MS, now).run();
  const message = renderMagicLink({ origin: originOf(env), path: "/auth/verify", token, kind: "login" });
  await emailProvider(env).send({ ...message, to: email });
}

async function createInvitation(env: Env, session: SessionRow, email: string, role: string, now: number): Promise<void> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "UPDATE invitations SET expires_at = ? WHERE club_id = ? AND email = ? AND accepted_at IS NULL AND expires_at > ?",
  ).bind(now, CLUB_ID, email, now).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO invitations (id, club_id, email, role, token_hash, expires_at, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, CLUB_ID, email, role, hash, now + INVITE_MS, session.user_id, now),
    audit(env.DB, session, "invite_created", "invitation", id, null, { email, role }, now),
  ]);
  const message = renderMagicLink({ origin: originOf(env), path: "/auth/invite", token, kind: "invite" });
  await emailProvider(env).send({ ...message, to: email });
}

async function reissuePendingInvite(env: Env, email: string, now: number): Promise<void> {
  const pending = await env.DB.prepare(
    "SELECT id, role, invited_by FROM invitations WHERE club_id = ? AND email = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
  ).bind(CLUB_ID, email, now).first<{ id: string; role: string; invited_by: string | null }>();
  if (!pending) return;
  const token = randomToken();
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    "UPDATE invitations SET token_hash = ?, expires_at = ? WHERE id = ? AND accepted_at IS NULL",
  ).bind(hash, now + INVITE_MS, pending.id).run();
  const message = renderMagicLink({ origin: originOf(env), path: "/auth/invite", token, kind: "invite" });
  await emailProvider(env).send({ ...message, to: email });
}

async function maybeBootstrapAdmin(env: Env, email: string, now: number): Promise<void> {
  const configured = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!configured || !(await secretsEqual(email, configured))) return;
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM club_memberships WHERE club_id = ? AND role = 'admin' AND status = 'active'",
  ).bind(CLUB_ID).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return;
  const userId = await ensureUser(env.DB, email, now);
  await ensureMembership(env.DB, userId, "admin", now);
  await env.DB.prepare(
    "INSERT INTO audit_events (id, club_id, actor_user_id, action, entity_type, entity_id, after_json, created_at) VALUES (?, ?, ?, 'bootstrap_admin', 'club_membership', ?, ?, ?)",
  ).bind(crypto.randomUUID(), CLUB_ID, userId, userId, JSON.stringify({ email }), now).run();
}

async function updateInjury(
  c: { env: Env },
  session: SessionRow,
  profileId: string,
  injuryStatus: string,
  injuryNote: string | null,
): Promise<boolean> {
  const current = await c.env.DB.prepare(
    `SELECT p.id, p.injury_status, p.injury_note
     FROM player_profiles p JOIN club_memberships m ON m.id = p.membership_id
     WHERE p.id = ? AND m.club_id = ?`,
  ).bind(profileId, CLUB_ID).first<{ id: string; injury_status: string; injury_note: string | null }>();
  if (!current) return false;
  if (session.role === "player" && session.profile_id !== profileId) return false;
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE player_profiles SET injury_status = ?, injury_note = ?, updated_at = ? WHERE id = ?",
    ).bind(injuryStatus, injuryNote, now, profileId),
    audit(c.env.DB, session, "injury_updated", "player_profile", profileId, {
      injuryStatus: current.injury_status,
      injuryNote: current.injury_note,
    }, { injuryStatus, injuryNote }, now),
  ]);
  return true;
}

function audit(
  db: D1Database,
  session: SessionRow,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  now: number,
) {
  return db.prepare(
    `INSERT INTO audit_events (
      id, club_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    CLUB_ID,
    session.user_id,
    action,
    entityType,
    entityId,
    before === null ? null : JSON.stringify(before),
    JSON.stringify(after),
    now,
  );
}

async function startSession(c: AppContext, userId: string, now: number, expectedHash?: string): Promise<boolean> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const old = getCookie(c, SESSION_COOKIE);
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL")
      .bind(now, old ? await sha256Hex(old) : ""),
    c.env.DB.prepare(`INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at)
      SELECT ?,?,?,?,? WHERE (? IS NULL OR EXISTS(
        SELECT 1 FROM credentials cr JOIN users u ON u.id=cr.user_id
        JOIN club_memberships m ON m.user_id=u.id AND m.club_id=?
        WHERE cr.user_id=? AND cr.password_hash=? AND u.status='active' AND m.status='active'))`)
      .bind(crypto.randomUUID(), userId, hash, now + SESSION_MS, now, expectedHash ?? null, CLUB_ID, userId, expectedHash ?? null),
  ]);
  if (results[1]!.meta.changes !== 1) return false;
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  return true;
}

async function currentSession(c: AppContext): Promise<SessionRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const session = await c.env.DB.prepare(
    `SELECT u.id AS user_id, u.email, u.name, u.status AS user_status, u.email_notifications,
            m.id AS membership_id, m.role, m.status AS membership_status, m.club_id,
            p.id AS profile_id, p.roster_name, p.position_id, p.group_id, p.injury_status, p.injury_note,
            p.training_locked, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN club_memberships m ON m.user_id = u.id AND m.club_id = ? AND m.status = 'active'
     LEFT JOIN player_profiles p ON p.membership_id = m.id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status != 'disabled'`,
  ).bind(CLUB_ID, hash, Date.now()).first<SessionRow>();
  if (!session) return null;
  if (session.expires_at - Date.now() < SESSION_SLIDE_MS) {
    const expiresAt = Date.now() + SESSION_MS;
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(expiresAt, hash).run();
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === "https:",
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MS / 1000,
    });
  }
  return session;
}

function presentSession(session: SessionRow) {
  return {
    user: {
      id: session.user_id,
      email: session.email.endsWith("@members.invalid") ? "" : session.email,
      name: session.name,
      emailNotifications: session.email_notifications === 1,
    },
    membership: { id: session.membership_id, role: session.role, clubId: session.club_id, status: session.membership_status },
    pendingApproval: session.user_status === "invited",
    profile: session.profile_id
      ? {
          id: session.profile_id,
          rosterName: session.roster_name,
          positionId: session.position_id,
          groupId: session.group_id,
          injuryStatus: session.injury_status,
          injuryNote: session.injury_note,
        }
      : null,
    needsOnboarding: session.role === "player" && session.user_status !== "invited" && !session.profile_id,
  };
}

async function findActiveMember(db: D1Database, email: string): Promise<{ user_id: string; role: string } | null> {
  return db.prepare(
    `SELECT u.id AS user_id, m.role FROM users u
     JOIN club_memberships m ON m.user_id = u.id
     WHERE u.email = ? AND m.club_id = ? AND m.status = 'active' AND u.status != 'disabled'`,
  ).bind(email, CLUB_ID).first<{ user_id: string; role: string }>();
}

async function profileForUser(db: D1Database, userId: string): Promise<{ id: string } | null> {
  return db.prepare(
    `SELECT p.id FROM player_profiles p
     JOIN club_memberships m ON m.id = p.membership_id
     WHERE m.user_id = ? AND m.club_id = ?`,
  ).bind(userId, CLUB_ID).first<{ id: string }>();
}

async function ensureUser(db: D1Database, email: string, now: number): Promise<string> {
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const name = email.split("@")[0]?.slice(0, 40) || "Player";
  await db.prepare(
    "INSERT INTO users (id, email, name, status, email_verified_at, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
  ).bind(id, email, name, now, now, now).run();
  return id;
}

async function ensureMembership(db: D1Database, userId: string, role: string, now: number): Promise<void> {
  const existing = await db.prepare(
    "SELECT id, status FROM club_memberships WHERE club_id = ? AND user_id = ?",
  ).bind(CLUB_ID, userId).first<{ id: string; status: string }>();
  if (existing?.status === "active") return;
  if (existing) {
    await db.prepare(
      "UPDATE club_memberships SET role = ?, status = 'active', updated_at = ? WHERE id = ?",
    ).bind(role, now, existing.id).run();
    return;
  }
  await db.prepare(
    "INSERT INTO club_memberships (id, club_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
  ).bind(crypto.randomUUID(), CLUB_ID, userId, role, now, now).run();
}

function attemptLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function allowAttempt(db: D1Database, bucket: string, limit: number, now: number): Promise<boolean> {
  const count = await db.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE bucket_key = ? AND created_at > ?",
  ).bind(bucket, now - RATE_WINDOW_MS).first<{ n: number }>();
  if ((count?.n ?? 0) >= limit) return false;
  await db.prepare(
    "INSERT INTO login_attempts (id, bucket_key, created_at) VALUES (?, ?, ?)",
  ).bind(crypto.randomUUID(), bucket, now).run();
  return true;
}

function emailProvider(env: Env): EmailProvider {
  if (env.EMAIL_PROVIDER === "console") return consoleEmailProvider(env.DB);
  if (!env.EMAIL || !env.EMAIL_FROM) throw new EmailConfigError();
  return cloudflareEmailProvider(env.EMAIL, env.EMAIL_FROM);
}

function originOf(env: Env): string {
  const origin = env.APP_ORIGIN?.replace(/\/$/, "");
  if (!origin) throw new EmailConfigError();
  return origin;
}

class EmailConfigError extends Error {
  constructor() {
    super("Email is not configured.");
    this.name = "EmailConfigError";
  }
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function readJson(c: { req: { header: (name: string) => string | undefined; json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > 20_000) return null;
  try {
    const value = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function normalizeRosterName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 40 || !ROSTER_RE.test(name)) return null;
  return name;
}

function normalizeInjury(value: unknown): "available" | "limited" | "out" | null {
  if (value === "available" || value === "limited" || value === "out") return value;
  return null;
}

function normalizeNote(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (note.length > 200) return null;
  return note || null;
}
