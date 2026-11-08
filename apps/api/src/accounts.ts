import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";
import { hashPassword, normalizeUsername, validPassword, verifyPassword } from "./passwords";
import { randomToken, sha256Hex } from "./tokens";

const CLUB = clubCatalog.id;
const MINUTE = 60_000;
const INVALID_LINK = "This registration link is invalid, disabled, or expired. Ask a club administrator for the current link.";
const INVALID_RESET = "This password reset link is invalid, expired, or already used.";
const INVALID_LOGIN = "Username or password is incorrect.";
type C = Context<{ Bindings: Env }>;
interface Actor { user_id: string; role: string; user_status: string }
interface Credentials { user_id: string; username: string; password_hash: string }
interface Registration { token_hash: string; enabled: number; expires_at: number | null }

export function registerAccountRoutes(
  app: Hono<{ Bindings: Env }>,
  currentSession: (c: C) => Promise<Actor | null>,
  startSession: (c: C, userId: string, now: number, expectedHash?: string) => Promise<boolean>,
) {
  for (const path of ["/api/auth/login", "/api/auth/register", "/api/auth/reset", "/api/auth/reset/options",
    "/api/registration/options", "/api/me/credentials", "/api/registration", "/api/password-resets"]) {
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
    if (!await throttle(c, "register", 10, 60 * MINUTE)) return limited(c);
    const body = await json(c);
    const link = await registration(c, body?.token);
    if (!link) return c.json({ error: INVALID_LINK }, 410);
    if (await currentSession(c)) return c.json({ error: "You are already signed in. Add credentials from You to keep your existing training history." }, 409);
    const username = normalizeUsername(body?.username);
    const name = typeof body?.fullName === "string" ? body.fullName.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 60 || !/^[\p{L}\p{M} .'-]+$/u.test(name)) return c.json({ error: "Enter your full name (up to 60 characters)." }, 400);
    const validation = credentialError(body, username);
    if (validation) return c.json({ error: validation }, 400);
    // The position/group relationship is authoritative; arbitrary group and role IDs are never trusted.
    const position = await c.env.DB.prepare("SELECT id,group_id FROM positions WHERE id=? AND club_id=?")
      .bind(typeof body?.positionId === "string" ? body.positionId : "", CLUB).first<{ id: string; group_id: string }>();
    if (!position || body?.groupId !== position.group_id) return c.json({ error: "Choose a position and its matching playing group." }, 400);
    const now = Date.now(), userId = crypto.randomUUID(), membership = crypto.randomUUID();
    const passwordHash = await hashPassword(body!.password as string);
    try {
      // The link is checked again inside the transaction, so disable/rotation wins against in-flight hashing.
      // A failed user insert makes the dependent credential FK fail and rolls back the complete batch.
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO users(id,email,name,status,created_at,updated_at)
          SELECT ?,?,?,'active',?,? FROM team_registration WHERE club_id=? AND token_hash=? AND enabled=1
          AND (expires_at IS NULL OR expires_at>?)`)
          .bind(userId, `m.${userId}@members.invalid`, name, now, now, CLUB, link.token_hash, Date.now()),
        c.env.DB.prepare("INSERT INTO credentials(user_id,username,password_hash,password_updated_at,created_at,updated_at) VALUES(?,?,?,?,?,?)")
          .bind(userId, username, passwordHash, now, now, now),
        c.env.DB.prepare("INSERT INTO club_memberships(id,club_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,'player','active',?,?)")
          .bind(membership, CLUB, userId, now, now),
        c.env.DB.prepare(`INSERT INTO player_profiles(id,membership_id,roster_name,position_id,group_id,injury_status,training_locked,created_at,updated_at)
          VALUES(?,?,?,?,?,'available',0,?,?)`).bind(crypto.randomUUID(), membership, name, position.id, position.group_id, now, now),
        audit(c, userId, "player_registered", "user", userId, now),
      ]);
    } catch {
      if (!await registration(c, body?.token)) return c.json({ error: INVALID_LINK }, 410);
      return c.json({ error: "That username is unavailable. Choose another username." }, 409);
    }
    await startSession(c, userId, Date.now(), passwordHash);
    return c.json({ ok: true }, 201);
  });

  app.post("/api/auth/login", async c => {
    const body = await json(c);
    const username = normalizeUsername(body?.username);
    if (!await throttle(c, "login-ip", 60) || !await throttle(c, "login-account", 15, 15 * MINUTE, username ?? "invalid")) return limited(c);
    const password = typeof body?.password === "string" && body.password.length <= 128 ? body.password : "";
    const cred = await c.env.DB.prepare(
      `SELECT cr.user_id,cr.username,cr.password_hash FROM credentials cr
       JOIN users u ON u.id=cr.user_id JOIN club_memberships m ON m.user_id=u.id AND m.club_id=?
       WHERE cr.username=? COLLATE NOCASE AND u.status='active' AND m.status='active'`,
    ).bind(CLUB, username ?? "").first<Credentials>();
    // Missing and disabled accounts perform the same expensive verification and return the same error.
    const valid = await verifyPassword(password, cred?.password_hash ?? null);
    if (!valid || !cred) return c.json({ error: INVALID_LOGIN }, 401);
    if (!await startSession(c, cred.user_id, Date.now(), cred.password_hash)) return c.json({ error: INVALID_LOGIN }, 401);
    return c.json({ ok: true });
  });

  app.get("/api/me/credentials", async c => {
    const actor = await currentSession(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    const cred = await c.env.DB.prepare("SELECT username FROM credentials WHERE user_id=?").bind(actor.user_id).first<{ username: string | null }>();
    return c.json({ username: cred?.username ?? null });
  });

  app.post("/api/me/credentials", async c => {
    const actor = await currentSession(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.user_status !== "active") return c.json({ error: "An active membership is required." }, 403);
    if (!await throttle(c, "establish", 10, 15 * MINUTE, actor.user_id)) return limited(c);
    const body = await json(c), username = normalizeUsername(body?.username);
    const validation = credentialError(body, username);
    if (validation) return c.json({ error: validation }, 400);
    const previous = await c.env.DB.prepare("SELECT username FROM credentials WHERE user_id=?").bind(actor.user_id).first<{ username: string | null }>();
    if (previous?.username) return c.json({ error: "Credentials already exist. Ask an administrator for a password reset link." }, 409);
    const now = Date.now(), passwordHash = await hashPassword(body!.password as string);
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO credentials(user_id,username,password_hash,password_updated_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,
          password_updated_at=excluded.password_updated_at,updated_at=excluded.updated_at WHERE credentials.username IS NULL`)
          .bind(actor.user_id, username, passwordHash, now, now, now),
        c.env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, actor.user_id),
        c.env.DB.prepare("UPDATE access_links SET enabled=0 WHERE user_id=? AND kind='signin'").bind(actor.user_id),
        c.env.DB.prepare("UPDATE magic_links SET consumed_at=? WHERE email=(SELECT email FROM users WHERE id=?) AND consumed_at IS NULL").bind(now, actor.user_id),
        c.env.DB.prepare("UPDATE password_resets SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL").bind(now, actor.user_id),
        audit(c, actor.user_id, "credentials_established", "user", actor.user_id, now),
      ]);
    } catch { return c.json({ error: "That username is unavailable. Choose another username." }, 409); }
    if (!await startSession(c, actor.user_id, Date.now(), passwordHash)) return c.json({ error: "Credentials changed. Sign in again." }, 409);
    return c.json({ ok: true });
  });

  app.get("/api/registration", async c => {
    const actor = await currentSession(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.role !== "admin") return c.json({ error: "Admins only." }, 403);
    const link = await c.env.DB.prepare("SELECT enabled,expires_at,updated_at FROM team_registration WHERE club_id=?").bind(CLUB).first();
    const players = await c.env.DB.prepare(`SELECT u.id,u.name,cr.username,cr.created_at,m.status,p.roster_name
      FROM credentials cr JOIN users u ON u.id=cr.user_id JOIN club_memberships m ON m.user_id=u.id AND m.club_id=?
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

  app.post("/api/password-resets", async c => {
    const actor = await currentSession(c);
    if (!actor) return c.json({ error: "Sign in required." }, 401);
    if (actor.role !== "admin") return c.json({ error: "Admins only." }, 403);
    if (!await throttle(c, "reset-admin", 20, 15 * MINUTE, actor.user_id)) return limited(c);
    const body = await json(c);
    const target = await c.env.DB.prepare(`SELECT u.id FROM users u JOIN club_memberships m ON m.user_id=u.id
      WHERE u.id=? AND m.club_id=? AND m.role='player' AND m.status='active' AND u.status='active'`)
      .bind(typeof body?.userId === "string" ? body.userId : "", CLUB).first<{ id: string }>();
    if (!target) return c.json({ error: "Active player not found." }, 404);
    const token = randomToken(), now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE password_resets SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL").bind(now, target.id),
      c.env.DB.prepare("INSERT INTO password_resets(id,user_id,token_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), target.id, await sha256Hex(token), now + 15 * MINUTE, actor.user_id, now),
      audit(c, actor.user_id, "password_reset_created", "user", target.id, now),
    ]);
    return c.json({ url: `${origin(c)}/reset-password#token=${token}`, expiresAt: now + 15 * MINUTE }, 201);
  });

  app.post("/api/auth/reset/options", async c => {
    if (!await throttle(c, "reset-options", 30)) return limited(c);
    const body = await json(c);
    const reset = await resetFor(c, body?.token);
    if (!reset) return c.json({ error: INVALID_RESET }, 410);
    const cred = await c.env.DB.prepare("SELECT username FROM credentials WHERE user_id=?").bind(reset.user_id).first<{ username: string | null }>();
    return c.json({ needsUsername: !cred?.username });
  });

  app.post("/api/auth/reset", async c => {
    if (!await throttle(c, "reset", 10)) return limited(c);
    const body = await json(c), reset = await resetFor(c, body?.token);
    if (!reset) return c.json({ error: INVALID_RESET }, 410);
    if (!validPassword(body?.password) || body.password !== body.confirmPassword) return c.json({ error: "Use 12–128 characters and matching passwords." }, 400);
    const cred = await c.env.DB.prepare("SELECT username FROM credentials WHERE user_id=?").bind(reset.user_id).first<{ username: string | null }>();
    const username = cred?.username ?? normalizeUsername(body?.username);
    if (!username) return c.json({ error: "Choose a username: 3–30 letters, numbers, dots, underscores, or hyphens." }, 400);
    const hash = await hashPassword(body.password), now = Date.now(), claim = randomToken();
    try {
      const results = await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE password_resets SET consumed_at=?,claim=? WHERE id=? AND consumed_at IS NULL AND expires_at>?
          AND EXISTS(SELECT 1 FROM users u JOIN club_memberships m ON m.user_id=u.id WHERE u.id=password_resets.user_id
          AND u.status='active' AND m.status='active' AND m.role='player' AND m.club_id=?)`).bind(now, claim, reset.id, now, CLUB),
        c.env.DB.prepare(`INSERT INTO credentials(user_id,username,password_hash,password_updated_at,created_at,updated_at)
          SELECT user_id,?,?,?, ?,? FROM password_resets WHERE id=? AND claim=?
          ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,username=excluded.username,
          password_updated_at=excluded.password_updated_at,updated_at=excluded.updated_at`).bind(username, hash, now, now, now, reset.id, claim),
        c.env.DB.prepare(`UPDATE sessions SET revoked_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM password_resets WHERE id=? AND claim=?)`).bind(now, reset.user_id, reset.id, claim),
        c.env.DB.prepare(`UPDATE access_links SET enabled=0 WHERE user_id=? AND kind='signin' AND EXISTS(SELECT 1 FROM password_resets WHERE id=? AND claim=?)`).bind(reset.user_id, reset.id, claim),
        c.env.DB.prepare(`UPDATE magic_links SET consumed_at=? WHERE email=(SELECT email FROM users WHERE id=?) AND consumed_at IS NULL
          AND EXISTS(SELECT 1 FROM password_resets WHERE id=? AND claim=?)`).bind(now, reset.user_id, reset.id, claim),
        c.env.DB.prepare(`INSERT INTO audit_events(id,club_id,actor_user_id,action,entity_type,entity_id,created_at)
          SELECT ?,?,user_id,'password_reset_completed','user',user_id,? FROM password_resets WHERE id=? AND claim=?`)
          .bind(crypto.randomUUID(), CLUB, now, reset.id, claim),
      ]);
      if (results[0]!.meta.changes !== 1) return c.json({ error: INVALID_RESET }, 410);
    } catch { return c.json({ error: "That username is unavailable. Choose another username." }, 409); }
    // No session is granted by the reset token. New credentials must be used to sign in.
    return c.json({ ok: true });
  });
}

function credentialError(body: Record<string, unknown> | null, username: string | null) {
  if (!username) return "Choose a username: 3–30 letters, numbers, dots, underscores, or hyphens.";
  if (!validPassword(body?.password)) return "Use a password with 12–128 characters.";
  if (body.password !== body.confirmPassword) return "Passwords do not match.";
  return null;
}
async function registration(c: C, token: unknown): Promise<Registration | null> {
  if (!validToken(token)) return null;
  return c.env.DB.prepare(`SELECT token_hash,enabled,expires_at FROM team_registration
    WHERE club_id=? AND token_hash=? AND enabled=1 AND (expires_at IS NULL OR expires_at>?)`)
    .bind(CLUB, await sha256Hex(token), Date.now()).first<Registration>();
}
async function resetFor(c: C, token: unknown) {
  if (!validToken(token)) return null;
  return c.env.DB.prepare(`SELECT r.id,r.user_id FROM password_resets r JOIN users u ON u.id=r.user_id
    JOIN club_memberships m ON m.user_id=u.id AND m.club_id=? AND m.status='active'
    WHERE r.token_hash=? AND r.consumed_at IS NULL AND r.expires_at>? AND u.status='active' AND m.role='player'`)
    .bind(CLUB, await sha256Hex(token), Date.now()).first<{ id: string; user_id: string }>();
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
function limited(c: C) { c.header("Retry-After", "900"); return c.json({ error: "Too many attempts. Try again later." }, 429); }
async function throttle(c: C, kind: string, max: number, window = 15 * MINUTE, identity?: string) {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const bucket = kind + ":" + await sha256Hex(identity ?? ip);
  const start = Math.floor(Date.now() / window) * window;
  const row = await c.env.DB.prepare(`INSERT INTO auth_limits(bucket,window_start,attempts) VALUES(?,?,1)
    ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,
    attempts=CASE WHEN auth_limits.window_start=excluded.window_start THEN auth_limits.attempts+1 ELSE 1 END RETURNING attempts`)
    .bind(bucket, start).first<{ attempts: number }>();
  // Bound retention without background jobs or storing raw IP addresses/usernames.
  await c.env.DB.prepare("DELETE FROM auth_limits WHERE window_start<?").bind(Date.now() - 24 * 60 * MINUTE).run();
  return (row?.attempts ?? max + 1) <= max;
}
