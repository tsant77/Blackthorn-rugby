import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";
import { randomToken, sha256Hex } from "./tokens";

const CLUB = clubCatalog.id;
const MINUTE = 60_000;
const INVALID_LINK = "This registration link is invalid, disabled, or expired. Ask a club administrator for the current link.";

const INVALID_LOGIN = "This personal login link is invalid or revoked. Ask a coach or administrator for a replacement.";
type C = Context<{ Bindings: Env }>;
interface Actor { user_id: string; role: string; user_status: string }
interface Registration { token_hash: string; enabled: number; expires_at: number | null }

export function registerAccountRoutes(
  app: Hono<{ Bindings: Env }>,
  currentSession: (c: C) => Promise<Actor | null>,
  startSession: (c: C, userId: string, now: number, expectedHash?: string) => Promise<boolean>,
) {
  for (const path of ["/api/auth/login", "/api/auth/register", "/api/registration/options",
    "/api/me/login-link", "/api/player-login-links", "/api/registration"]) {
    app.use(path, bodyLimit({ maxSize: 8192, onError: c => c.json({ error: "Request is too large." }, 413) }));
  }

  app.post("/api/registration/options", async c => {
    if (!await throttle(c, "registration-options", 60)) return limited(c);
    const body = await json(c);
    if (!await registration(c, body?.token)) return c.json({ error: INVALID_LINK }, 410);
    const rows = await c.env.DB.prepare(
      `SELECT p.id,p.name,p.group_id,g.name AS group_name FROM positions p
       JOIN groups g ON g.id=p.group_id WHERE p.club_id=? ORDER BY p.sort_order`,
    ).bind(CLUB).all();
    return c.json({ positions: rows.results });
  });

  app.post("/api/auth/register", async c => {
    if (!await throttle(c, "register", 60, 60 * MINUTE)) return limited(c);
    const body = await json(c);
    const link = await registration(c, body?.token);
    if (!link) return c.json({ error: INVALID_LINK }, 410);
    if (!await throttle(c, "register-team", 200, 60 * MINUTE, link.token_hash)) return limited(c);
    if (await currentSession(c)) return c.json({ error: "You are already signed in. Go to You to save a personal login link and keep your training history." }, 409);
    const name = typeof body?.fullName === "string" ? body.fullName.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 60 || !/^[\p{L}\p{M} .'-]+$/u.test(name)) return c.json({ error: "Enter your full name (up to 60 characters)." }, 400);
    // The position/group relationship is authoritative; arbitrary group and role IDs are never trusted.
    const position = await c.env.DB.prepare("SELECT id,group_id FROM positions WHERE id=? AND club_id=?")
      .bind(typeof body?.positionId === "string" ? body.positionId : "", CLUB).first<{ id: string; group_id: string }>();
    if (!position || body?.groupId !== position.group_id) return c.json({ error: "Choose a position and its matching playing group." }, 400);
    const now = Date.now(), userId = crypto.randomUUID(), membership = crypto.randomUUID();
    const token = randomToken(), tokenHash = await sha256Hex(token);
    try {
      // The link is checked again inside the transaction, so disable/rotation wins against in-flight registration.
      // A failed user insert makes the dependent credential FK fail and rolls back the complete batch.
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO users(id,email,name,status,created_at,updated_at)
          SELECT ?,?,?,'active',?,? FROM team_registration WHERE club_id=? AND token_hash=? AND enabled=1
          AND (expires_at IS NULL OR expires_at>?)`)
          .bind(userId, `m.${userId}@members.invalid`, name, now, now, CLUB, link.token_hash, Date.now()),
        c.env.DB.prepare("INSERT INTO player_login_links(user_id,token_hash,created_at,updated_at) VALUES(?,?,?,?)")
          .bind(userId, tokenHash, now, now),
        c.env.DB.prepare("INSERT INTO club_memberships(id,club_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,'player','active',?,?)")
          .bind(membership, CLUB, userId, now, now),
        c.env.DB.prepare(`INSERT INTO player_profiles(id,membership_id,roster_name,position_id,group_id,injury_status,training_locked,created_at,updated_at)
          VALUES(?,?,?,?,?,'available',0,?,?)`).bind(crypto.randomUUID(), membership, name, position.id, position.group_id, now, now),
        audit(c, userId, "player_registered", "user", userId, now),
      ]);
    } catch {
      if (!await registration(c, body?.token)) return c.json({ error: INVALID_LINK }, 410);
      return c.json({ error: "Could not create your account. Reopen the registration link and try again." }, 409);
    }
    if (!await startSession(c, userId, Date.now(), tokenHash)) return c.json({ error: INVALID_LOGIN }, 409);
    return c.json({ ok: true, url: loginUrl(c, token) }, 201);
  });

  app.post("/api/auth/login", async c => {
    if (!await throttle(c, "player-login", 60)) return limited(c);
    const body = await json(c);
    if (!validToken(body?.token)) return c.json({ error: INVALID_LOGIN }, 401);
    const hash = await sha256Hex(body.token);
    const link = await c.env.DB.prepare(`SELECT l.user_id FROM player_login_links l
      JOIN users u ON u.id=l.user_id JOIN club_memberships m ON m.user_id=u.id
      WHERE l.token_hash=? AND m.club_id=? AND m.role='player' AND m.status='active' AND u.status='active'`)
      .bind(hash, CLUB).first<{ user_id: string }>();
    if (!link || !await startSession(c, link.user_id, Date.now(), hash)) return c.json({ error: INVALID_LOGIN }, 401);
    return c.json({ ok: true });
  });

  app.get("/api/me/login-link", async c => {
    const actor = await currentSession(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    const link = await c.env.DB.prepare("SELECT created_at FROM player_login_links WHERE user_id=?").bind(actor.user_id).first();
    return c.json({ exists: Boolean(link), player: actor.role === "player" });
  });

  // Only players receive reusable links. Staff keep the separate admin-issued access path.
  for (const path of ["/api/me/login-link", "/api/player-login-links"]) app.post(path, async c => {
    const actor = await currentSession(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.user_status !== "active") return c.json({ error: "Active membership required." }, 403);
    if (!await throttle(c, "manage-player-link", 20, 15 * MINUTE, actor.user_id)) return limited(c);
    const body = await json(c);
    const self = path === "/api/me/login-link";
    if (!self && actor.role !== "coach" && actor.role !== "admin") return c.json({ error: "Coaches only." }, 403);
    const id = self ? actor.user_id : typeof body?.userId === "string" ? body.userId : "";
    const target = await c.env.DB.prepare(`SELECT u.id FROM users u JOIN club_memberships m ON m.user_id=u.id
      WHERE u.id=? AND m.club_id=? AND m.role='player' AND m.status='active' AND u.status='active'`)
      .bind(id, CLUB).first<{ id: string }>();
    if (!target) return c.json({ error: "Active player not found." }, 404);
    if (body?.action !== "rotate" && body?.action !== "revoke") return c.json({ error: "Choose rotate or revoke." }, 400);
    const now = Date.now(), token = randomToken(), hash = await sha256Hex(token);
    await c.env.DB.batch([
      ...(body.action === "revoke" ? [c.env.DB.prepare("DELETE FROM player_login_links WHERE user_id=?").bind(id)] : [
        c.env.DB.prepare(`INSERT INTO player_login_links(user_id,token_hash,created_at,updated_at)
          SELECT u.id,?,?,? FROM users u JOIN club_memberships m ON m.user_id=u.id
          WHERE u.id=? AND m.club_id=? AND m.role='player' AND m.status='active' AND u.status='active'
          ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,updated_at=excluded.updated_at`)
          .bind(hash, now, now, id, CLUB),
      ]),
      c.env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, id),
      c.env.DB.prepare("UPDATE access_links SET enabled=0 WHERE user_id=? AND kind='signin'").bind(id),
      c.env.DB.prepare("UPDATE magic_links SET consumed_at=? WHERE email=(SELECT email FROM users WHERE id=?) AND consumed_at IS NULL").bind(now, id),
      c.env.DB.prepare("UPDATE password_resets SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL").bind(now, id),
      audit(c, actor.user_id, body.action === "revoke" ? "player_link_revoked" : "player_link_rotated", "user", id, now),
    ]);
    if (body.action === "revoke") return c.json({ ok: true });
    if (self && !await startSession(c, id, Date.now(), hash)) return c.json({ error: INVALID_LOGIN }, 409);
    return c.json({ url: loginUrl(c, token) }, 201);
  });

  app.get("/api/registration", async c => {
    const actor = await currentSession(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.role !== "admin") return c.json({ error: "Admins only." }, 403);
    const link = await c.env.DB.prepare("SELECT enabled,expires_at,updated_at FROM team_registration WHERE club_id=?").bind(CLUB).first();
    const players = await c.env.DB.prepare(`SELECT u.id,u.name,cr.created_at,m.status,p.roster_name
      FROM player_login_links cr JOIN users u ON u.id=cr.user_id JOIN club_memberships m ON m.user_id=u.id AND m.club_id=?
      LEFT JOIN player_profiles p ON p.membership_id=m.id WHERE m.role='player' ORDER BY cr.created_at DESC LIMIT 30`).bind(CLUB).all();
    return c.json({ link, players: players.results });
  });

  app.post("/api/registration", async c => {
    const actor = await currentSession(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.role !== "admin") return c.json({ error: "Admins only." }, 403);
    if (!await throttle(c, "manage-registration", 20, 15 * MINUTE, actor.user_id)) return limited(c);
    const body = await json(c), now = Date.now();
    if (body?.action === "rotate") {
      const token = randomToken();
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO team_registration(club_id,token_hash,enabled,created_by,created_at,updated_at)
          VALUES(?,?,1,?,?,?) ON CONFLICT(club_id) DO UPDATE SET token_hash=excluded.token_hash,enabled=1,expires_at=NULL,
          created_by=excluded.created_by,updated_at=excluded.updated_at`).bind(CLUB, await sha256Hex(token), actor.user_id, now, now),
        audit(c, actor.user_id, "registration_rotated", "club", CLUB, now),
      ]);
      return c.json({ url: `${origin(c)}/join#token=${token}` }, 201);
    }
    if (typeof body?.enabled !== "boolean") return c.json({ error: "Choose enable, disable, or rotate." }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE team_registration SET enabled=?,updated_at=? WHERE club_id=?").bind(body.enabled ? 1 : 0, now, CLUB),
      audit(c, actor.user_id, body.enabled ? "registration_enabled" : "registration_disabled", "club", CLUB, now),
    ]);
    return c.json({ ok: true });
  });

}

function loginUrl(c: C, token: string) { return `${origin(c)}/player-login#token=${token}`; }
async function registration(c: C, token: unknown): Promise<Registration | null> {
  if (!validToken(token)) return null;
  return c.env.DB.prepare(`SELECT token_hash,enabled,expires_at FROM team_registration
    WHERE club_id=? AND token_hash=? AND enabled=1 AND (expires_at IS NULL OR expires_at>?)`)
    .bind(CLUB, await sha256Hex(token), Date.now()).first<Registration>();
}
function validToken(token: unknown): token is string { return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token); }
function origin(c: C) { return c.env.APP_ORIGIN?.replace(/\/$/, "") || new URL(c.req.url).origin; }
function audit(c: C, actor: string, action: string, type: string, id: string, now: number) {
  return c.env.DB.prepare("INSERT INTO audit_events(id,club_id,actor_user_id,action,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), CLUB, actor, action, type, id, now);
}
async function json(c: C): Promise<Record<string, unknown> | null> {
  try { const b = await c.req.json(); return b && typeof b === "object" && !Array.isArray(b) ? b : null; } catch { return null; }
}
function limited(c: C) { return c.json({ error: "Too many attempts. Try again later." }, 429); }
export async function throttle(c: C, kind: string, max: number, window = 15 * MINUTE, identity?: string) {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const bucket = kind + ":" + await sha256Hex(identity ?? ip);
  const start = Math.floor(Date.now() / window) * window;
  const [attempts] = await c.env.DB.batch<{ attempts: number }>([
    c.env.DB.prepare(`INSERT INTO auth_limits(bucket,window_start,attempts) VALUES(?,?,1)
    ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,
    attempts=CASE WHEN auth_limits.window_start=excluded.window_start THEN auth_limits.attempts+1 ELSE 1 END RETURNING attempts`)
    .bind(bucket, start),
    // Bound retention without background jobs or storing raw IP addresses/usernames.
    c.env.DB.prepare("DELETE FROM auth_limits WHERE window_start<?").bind(Date.now() - 24 * 60 * MINUTE),
  ]);
  const row = attempts?.results[0];
  const allowed = (row?.attempts ?? max + 1) <= max;
  if (!allowed) c.header("Retry-After", String(Math.max(1, Math.ceil((start + window - Date.now()) / 1000))));
  return allowed;
}
