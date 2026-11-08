import type { Context, Hono } from "hono";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";
import { randomToken, secretsEqual, sha256Hex } from "./tokens";

const CLUB_ID = clubCatalog.id;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNIN_MS = 15 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;

type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

interface Actor {
  user_id: string;
  role: string;
}

export function emailEnabled(env: Env): boolean {
  return env.EMAIL_PROVIDER === "console" || env.EMAIL_PROVIDER === "cloudflare";
}

export function registerLinkRoutes(
  app: Hono<AppEnv>,
  currentSession: (c: AppContext) => Promise<Actor | null>,
  startSession: (c: AppContext, userId: string, now: number) => Promise<void>,
): void {
  app.get("/api/auth/options", (c) => c.json({ emailEnabled: emailEnabled(c.env) }));

  app.post("/api/setup", async (c) => {
    const now = Date.now();
    if (!(await allow(c.env.DB, `setup:${clientIp(c)}`, 10, now))) {
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }
    const secret = c.env.BOOTSTRAP_TOKEN?.trim();
    if (!secret) return c.json({ error: "Setup is not available." }, 404);
    const body = await readJson(c);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const name = cleanLabel(body?.name);
    if (!token || token.length > 200) return c.json({ error: "Enter the setup token." }, 400);
    if (!name) return c.json({ error: "Enter your name." }, 400);
    if (!(await secretsEqual(token, secret))) return c.json({ error: "That setup token is not valid." }, 403);
    const admins = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM club_memberships WHERE club_id = ? AND role = 'admin' AND status = 'active'",
    ).bind(CLUB_ID).first<{ n: number }>();
    if ((admins?.n ?? 0) > 0) return c.json({ error: "This club already has an admin." }, 409);
    const consumed = await c.env.DB.prepare(
      "SELECT bootstrap_consumed_at FROM clubs WHERE id = ?",
    ).bind(CLUB_ID).first<{ bootstrap_consumed_at: number | null }>();
    if (consumed?.bootstrap_consumed_at) return c.json({ error: "Setup has already been used." }, 409);
    const userId = await createLinkUser(c.env.DB, name, "active", now);
    await c.env.DB.prepare(
      "INSERT INTO club_memberships (id, club_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'active', ?, ?)",
    ).bind(crypto.randomUUID(), CLUB_ID, userId, now, now).run();
    await c.env.DB.prepare("UPDATE clubs SET bootstrap_consumed_at = ?, updated_at = ? WHERE id = ?").bind(now, now, CLUB_ID).run();
    await audit(c.env.DB, userId, "bootstrap_redeemed", "club", CLUB_ID, { name }, now);
    await startSession(c, userId, now);
    return c.json({ ok: true });
  });

  app.post("/api/share-invites", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const now = Date.now();
    if (!(await allow(c.env.DB, `links:${session.user_id}`, attemptLimit(c.env.AUTH_LINK_LIMIT, 20), now))) {
      return c.json({ error: "Too many links. Try again later." }, 429);
    }
    const body = await readJson(c);
    const label = cleanLabel(body?.label);
    const role = body?.role === "coach" || body?.role === "admin" ? body.role : body?.role === "player" ? "player" : "";
    if (!label) return c.json({ error: "Enter a name for this link." }, 400);
    if (!role) return c.json({ error: "Choose a role." }, 400);
    const url = await insertLink(c, {
      kind: "invite",
      role,
      label,
      userId: null,
      landing: null,
      ttl: INVITE_MS,
      createdBy: session.user_id,
      now,
    });
    await audit(c.env.DB, session.user_id, "invite_link_created", "access_link", url.id, { label, role }, now);
    return c.json({ ok: true, url: url.url, expiresAt: now + INVITE_MS }, 201);
  });

  app.get("/api/join-link", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const row = await currentClubLink(c.env.DB);
    return c.json({
      link: row ? { enabled: row.enabled === 1, expiresAt: row.expires_at, landing: row.landing, label: row.label } : null,
    });
  });

  app.post("/api/join-link", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const now = Date.now();
    if (!(await allow(c.env.DB, `links:${session.user_id}`, attemptLimit(c.env.AUTH_LINK_LIMIT, 20), now))) {
      return c.json({ error: "Too many links. Try again later." }, 429);
    }
    const body = await readJson(c);
    const landing = body?.landing === "pending" ? "pending" : "player";
    const days = Number(body?.days ?? 14);
    if (!Number.isInteger(days) || days < 1 || days > 90) return c.json({ error: "Choose an expiry between 1 and 90 days." }, 400);
    await c.env.DB.prepare(
      "UPDATE access_links SET enabled = 0 WHERE club_id = ? AND kind = 'club' AND enabled = 1",
    ).bind(CLUB_ID).run();
    const created = await insertLink(c, {
      kind: "club",
      role: "player",
      label: "Club join",
      userId: null,
      landing,
      ttl: days * 24 * 60 * 60 * 1000,
      createdBy: session.user_id,
      now,
    });
    await audit(c.env.DB, session.user_id, "join_link_created", "access_link", created.id, { landing, days }, now);
    return c.json({ ok: true, url: created.url, expiresAt: now + days * 24 * 60 * 60 * 1000, landing }, 201);
  });

  app.post("/api/join-link/disable", async (c) => {
    const session = await requireAdmin(c, currentSession);
    if (session instanceof Response) return session;
    const now = Date.now();
    await c.env.DB.prepare(
      "UPDATE access_links SET enabled = 0 WHERE club_id = ? AND kind = 'club' AND enabled = 1",
    ).bind(CLUB_ID).run();
    await audit(c.env.DB, session.user_id, "join_link_disabled", "club", CLUB_ID, null, now);
    return c.json({ ok: true });
  });

  app.post("/api/signin-links", async (c) => {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "Sign in required." }, 401);
    const now = Date.now();
    if (!(await allow(c.env.DB, `links:${session.user_id}`, attemptLimit(c.env.AUTH_LINK_LIMIT, 20), now))) {
      return c.json({ error: "Too many links. Try again later." }, 429);
    }
    const body = await readJson(c);
    const requested = typeof body?.userId === "string" ? body.userId : session.user_id;
    if (requested !== session.user_id && session.role !== "coach" && session.role !== "admin") {
      return c.json({ error: "Coaches only." }, 403);
    }
    const member = await c.env.DB.prepare(
      `SELECT u.id, u.name FROM users u
       JOIN club_memberships m ON m.user_id = u.id
       WHERE u.id = ? AND m.club_id = ? AND m.status = 'active' AND u.status != 'disabled'`,
    ).bind(requested, CLUB_ID).first<{ id: string; name: string }>();
    if (!member) return c.json({ error: "Member not found." }, 404);
    const created = await insertLink(c, {
      kind: "signin",
      role: null,
      label: member.name,
      userId: member.id,
      landing: null,
      ttl: SIGNIN_MS,
      createdBy: session.user_id,
      now,
    });
    await audit(c.env.DB, session.user_id, "signin_link_created", "access_link", created.id, { userId: member.id }, now);
    return c.json({ ok: true, url: created.url, expiresAt: now + SIGNIN_MS }, 201);
  });

  app.get("/link", async (c) => {
    const now = Date.now();
    const token = c.req.query("token") ?? "";
    if (!token || token.length > 200) return c.redirect("/login?error=invalid");
    if (!(await allow(c.env.DB, `redeem:${clientIp(c)}`, attemptLimit(c.env.AUTH_REDEEM_LIMIT, 30), now))) {
      return c.redirect("/login?error=limited");
    }
    const hash = await sha256Hex(token);
    const link = await c.env.DB.prepare(
      `SELECT id, kind, role, landing, label, user_id, expires_at, consumed_at, enabled
       FROM access_links WHERE token_hash = ? AND club_id = ?`,
    ).bind(hash, CLUB_ID).first<{
      id: string;
      kind: string;
      role: string | null;
      landing: string | null;
      label: string | null;
      user_id: string | null;
      expires_at: number;
      consumed_at: number | null;
      enabled: number;
    }>();
    if (!link || link.expires_at <= now || link.enabled !== 1) return c.redirect("/login?error=expired");
    if (link.kind !== "club" && link.consumed_at) return c.redirect("/login?error=expired");
    if (link.kind !== "club") {
      const consumed = await c.env.DB.prepare(
        "UPDATE access_links SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
      ).bind(now, link.id).run();
      if ((consumed.meta.changes ?? 0) !== 1) return c.redirect("/login?error=expired");
    }
    if (link.kind === "signin") {
      if (!link.user_id) return c.redirect("/login?error=expired");
      const member = await c.env.DB.prepare(
        `SELECT m.role, u.status FROM club_memberships m JOIN users u ON u.id = m.user_id
         WHERE m.user_id = ? AND m.club_id = ? AND m.status = 'active' AND u.status != 'disabled'`,
      ).bind(link.user_id, CLUB_ID).first<{ role: string; status: string }>();
      if (!member) return c.redirect("/login?error=expired");
      await audit(c.env.DB, link.user_id, "signin_link_redeemed", "access_link", link.id, null, now);
      await startSession(c, link.user_id, now);
      return c.redirect(member.status === "invited" ? "/pending" : "/");
    }
    const pending = link.kind === "club" && link.landing === "pending";
    const role = link.role === "coach" || link.role === "admin" ? link.role : "player";
    const userId = await createLinkUser(c.env.DB, link.label || "New player", pending ? "invited" : "active", now);
    await c.env.DB.prepare(
      "INSERT INTO club_memberships (id, club_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
    ).bind(crypto.randomUUID(), CLUB_ID, userId, role, now, now).run();
    await audit(c.env.DB, userId, link.kind === "club" ? "join_link_redeemed" : "invite_link_redeemed", "access_link", link.id, { role, pending }, now);
    await startSession(c, userId, now);
    if (pending) return c.redirect("/pending");
    return c.redirect(role === "player" ? "/onboarding" : "/");
  });
}

async function insertLink(c: AppContext, input: {
  kind: string;
  role: string | null;
  label: string | null;
  userId: string | null;
  landing: string | null;
  ttl: number;
  createdBy: string;
  now: number;
}): Promise<{ id: string; url: string }> {
  const token = randomToken();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO access_links (
      id, club_id, kind, token_hash, role, landing, label, user_id, expires_at, enabled, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(
    id, CLUB_ID, input.kind, await sha256Hex(token), input.role, input.landing, input.label, input.userId,
    input.now + input.ttl, input.createdBy, input.now,
  ).run();
  const origin = c.env.APP_ORIGIN?.replace(/\/$/, "") || new URL(c.req.url).origin;
  return { id, url: `${origin}/link?token=${encodeURIComponent(token)}` };
}

async function currentClubLink(db: D1Database) {
  return db.prepare(
    `SELECT enabled, expires_at, landing, label FROM access_links
     WHERE club_id = ? AND kind = 'club' ORDER BY created_at DESC LIMIT 1`,
  ).bind(CLUB_ID).first<{ enabled: number; expires_at: number; landing: string | null; label: string | null }>();
}

async function createLinkUser(db: D1Database, name: string, status: string, now: number): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, `m.${id}@members.invalid`, name, status, now, now).run();
  return id;
}

async function requireAdmin(c: AppContext, currentSession: (c: AppContext) => Promise<Actor | null>): Promise<Actor | Response> {
  const session = await currentSession(c);
  if (!session) return c.json({ error: "Sign in required." }, 401);
  if (session.role !== "admin") return c.json({ error: "Admins only." }, 403);
  return session;
}

async function allow(db: D1Database, bucket: string, limit: number, now: number): Promise<boolean> {
  const count = await db.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE bucket_key = ? AND created_at > ?",
  ).bind(bucket, now - RATE_WINDOW_MS).first<{ n: number }>();
  if ((count?.n ?? 0) >= limit) return false;
  await db.prepare("INSERT INTO login_attempts (id, bucket_key, created_at) VALUES (?, ?, ?)").bind(crypto.randomUUID(), bucket, now).run();
  return true;
}

function attemptLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function audit(db: D1Database, userId: string, action: string, entityType: string, entityId: string, after: unknown, now: number) {
  await db.prepare(
    `INSERT INTO audit_events (id, club_id, actor_user_id, action, entity_type, entity_id, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), CLUB_ID, userId, action, entityType, entityId, after ? JSON.stringify(after) : null, now).run();
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim().slice(0, 40);
  return label.length >= 2 ? label : null;
}

function clientIp(c: AppContext): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
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
