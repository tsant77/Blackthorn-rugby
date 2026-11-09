import { registerSuggestionRoutes } from "./suggestions";
import { registerScoringSettings } from "./scoring-settings";
import { registerAccountRoutes, throttle } from "./accounts";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { clubCatalog } from "@blackthorn/db/catalog";
import { randomToken, sha256Hex } from "./tokens";
import { registerAdminRoutes } from "./admin";
import { registerEngageRoutes } from "./engage";
import { registerAnalyticsRoutes } from "./analytics";
import { registerWorkoutRoutes } from "./workouts";
import { registerLinkRoutes } from "./links";

const CLUB_ID = clubCatalog.id;
const SESSION_COOKIE = "blackthorn_session";
const SESSION_MS = 180 * 24 * 60 * 60 * 1000;
const SESSION_SLIDE_MS = 90 * 24 * 60 * 60 * 1000;
const ROSTER_RE = /^[\p{L}\p{M}0-9 .'-]+$/u;

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  EMAIL_PROVIDER?: string;
  APP_ORIGIN?: string;
  BOOTSTRAP_TOKEN?: string;
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

  app.post("/api/auth/request", c => c.json({ error: "Email sign-in is no longer available. Use your personal login link." }, 410));

  app.get("/auth/verify", async (c) => consumeLegacyStaffLink(c));
  app.get("/auth/invite", c => c.redirect("/login?error=invalid"));

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
    return c.json({ error: "Email invitations are no longer available. Use a registration or staff invitation link." }, 410);
  });

  app.get("/api/dev/mailbox", c => c.json({ error: "Not found" }, 404));

  registerWorkoutRoutes(app, currentSession);
  registerSuggestionRoutes(app, currentSession);
  registerScoringSettings(app, currentSession);
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

// Preserve already-issued staff access without issuing or sending any new email links.
async function consumeLegacyStaffLink(c: AppContext): Promise<Response> {
  if (!await throttle(c, "legacy-staff-login", 30)) return c.redirect("/login?error=limited");
  const token = c.req.query("token") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return c.redirect("/login?error=invalid");
  const now = Date.now(), hash = await sha256Hex(token);
  const link = await c.env.DB.prepare(`SELECT l.id,u.id AS user_id FROM magic_links l
    JOIN users u ON u.email=l.email JOIN club_memberships m ON m.user_id=u.id
    WHERE l.token_hash=? AND l.consumed_at IS NULL AND l.expires_at>? AND m.club_id=?
    AND m.role IN ('coach','admin') AND m.status='active' AND u.status='active'`)
    .bind(hash, now, CLUB_ID).first<{ id: string; user_id: string }>();
  if (!link) return c.redirect("/login?error=expired");
  const result = await c.env.DB.prepare("UPDATE magic_links SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(now, link.id).run();
  if (result.meta.changes !== 1) return c.redirect("/login?error=expired");
  await startSession(c, link.user_id, now);
  return c.redirect("/");
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
    c.env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=? AND user_id=? AND revoked_at IS NULL")
      .bind(now, old ? await sha256Hex(old) : "", userId),
    c.env.DB.prepare(`INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at)
      SELECT ?,?,?,?,? WHERE (? IS NULL OR EXISTS(
        SELECT 1 FROM player_login_links cr JOIN users u ON u.id=cr.user_id
        JOIN club_memberships m ON m.user_id=u.id AND m.club_id=?
        WHERE cr.user_id=? AND cr.token_hash=? AND u.status='active' AND m.status='active' AND m.role='player'))`)
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
      email: "",
      name: session.name,
      emailNotifications: false,
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
