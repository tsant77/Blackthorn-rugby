import { beforeEach, describe, expect, it, vi } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase, testMemberSession } from "./test-db";
import { randomToken, sha256Hex } from "./tokens";

const cookie = (r: Response) => r.headers.get("set-cookie")?.split(";")[0] ?? "";
const tokenOf = (url: string) => new URL(url).hash.slice(7);

describe("Free-compatible personal player links", () => {
  let env: Env, admin: string;
  async function request(path: string, body?: unknown, auth = "", method = "POST", extra: Record<string, string> = {}) {
    return app.request("https://club.test" + path, { method, headers: { "content-type": "application/json", ...(auth ? { cookie: auth } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  }
  async function teamLink() {
    const r = await request("/api/registration", { action: "rotate" }, admin);
    expect(r.status).toBe(201);
    return tokenOf((await r.json() as { url: string }).url);
  }
  async function register(token: string, extra: Record<string, unknown> = {}) {
    return request("/api/auth/register", { token, fullName: "Test Wing", positionId: "pos_fullback", groupId: "group_backs", ...extra });
  }
  async function player() {
    const r = await register(await teamLink());
    expect(r.status).toBe(201);
    const { url } = await r.json() as { url: string };
    const me = await (await request("/api/me", undefined, cookie(r), "GET")).json() as { user: { id: string }; membership: { id: string }; profile: { id: string } };
    return { auth: cookie(r), token: tokenOf(url), url, id: me.user.id, membership: me.membership.id, profile: me.profile.id };
  }
  beforeEach(async () => {
    env = { DB: openTestDatabase(), BOOTSTRAP_TOKEN: "test-setup", EMAIL_PROVIDER: "none" };
    admin = cookie(await request("/api/setup", { name: "Coach", token: "test-setup" }));
  });

  it("registers two separate players with one team link, ignores privileged fields, and stores only token hashes", async () => {
    const shared = await teamLink();
    const a = await register(shared, { role: "admin", status: "invited", points: 9000 });
    const b = await register(shared);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    const first = await a.json() as { url: string }, second = await b.json() as { url: string };
    const token = tokenOf(first.url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(first.url).not.toBe(second.url); expect(token).not.toBe(shared);
    const rows = await env.DB.prepare("SELECT token_hash FROM player_login_links").bind().all<{ token_hash: string }>();
    expect(rows.results).toHaveLength(2); expect(rows.results.map(r => r.token_hash)).toContain(await sha256Hex(token));
    expect(JSON.stringify(rows.results)).not.toContain(token);
    const me = await (await request("/api/me", undefined, cookie(a), "GET")).json() as { membership: { role: string }; needsOnboarding: boolean; user: { email: string } };
    expect(me.membership.role).toBe("player"); expect(me.needsOnboarding).toBe(false); expect(me.user.email).toBe("");
    expect(a.headers.get("set-cookie")).toMatch(/HttpOnly/); expect(a.headers.get("set-cookie")).toMatch(/Secure/);
    expect(a.headers.get("set-cookie")).toMatch(/SameSite=Lax/); expect(a.headers.get("set-cookie")).toMatch(/Max-Age=15552000/);
    expect(a.headers.get("cache-control")).toBe("no-store"); expect(a.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM credentials").bind().first<{ n: number }>())?.n).toBe(0);
    expect((await request("/api/auth/login", { token: shared })).status).toBe(401);
    expect((await request("/api/auth/register", { token })).status).toBe(410);
  });

  it("supports repeated logins on multiple devices, persistent visits, sliding sessions, and independent logout", async () => {
    const p = await player();
    const one = await request("/api/auth/login", { token: p.token });
    const two = await request("/api/auth/login", { token: p.token });
    expect(one.status).toBe(200); expect(two.status).toBe(200); expect(cookie(one)).not.toBe(cookie(two));
    for (const auth of [p.auth, cookie(one), cookie(two)]) expect((await request("/api/me", undefined, auth, "GET")).status).toBe(200);
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE user_id=?").bind(Date.now()+1000, p.id).run();
    expect((await request("/api/me", undefined, cookie(two), "GET")).headers.get("set-cookie")).toMatch(/Max-Age=15552000/);
    await request("/api/auth/logout", {}, cookie(one));
    expect((await request("/api/me", undefined, cookie(one), "GET")).status).toBe(401);
    expect((await request("/api/me", undefined, cookie(two), "GET")).status).toBe(200);
  });

  it("lets coach/admin recover a player, revokes all old sessions and links, and preserves training data", async () => {
    const p = await player();
    const logged = await request("/api/workouts", { type: "running", durationMin: 40, clientRequestId: "link-migration-1111" }, p.auth);
    expect(logged.status).toBe(201);
    const before = await env.DB.prepare("SELECT * FROM point_transactions").bind().all();
    const coach = await testMemberSession(env.DB, "Recovery Coach", "coach");
    const rotated = await request("/api/player-login-links", { userId: p.id, action: "rotate" }, coach);
    expect(rotated.status).toBe(201);
    const next = tokenOf((await rotated.json() as { url: string }).url);
    expect((await request("/api/auth/login", { token: p.token })).status).toBe(401);
    expect((await request("/api/me", undefined, p.auth, "GET")).status).toBe(401);
    const signed = await request("/api/auth/login", { token: next }); expect(signed.status).toBe(200);
    const me = await (await request("/api/me", undefined, cookie(signed), "GET")).json() as { user: { id: string }; profile: { id: string } };
    expect(me.user.id).toBe(p.id); expect(me.profile.id).toBe(p.profile);
    expect((await env.DB.prepare("SELECT * FROM point_transactions").bind().all()).results).toEqual(before.results);
    expect((await request("/api/player-login-links", { userId: p.id, action: "revoke" }, admin)).status).toBe(200);
    expect((await request("/api/auth/login", { token: next })).status).toBe(401);
    expect((await request("/api/me", undefined, cookie(signed), "GET")).status).toBe(401);
  });

  it("never grants staff access through player links or coach recovery", async () => {
    const p = await player(), coach = await testMemberSession(env.DB, "Coach", "coach");
    const staff = await (await request("/api/me", undefined, coach, "GET")).json() as { user: { id: string } };
    expect((await request("/api/player-login-links", { userId: staff.user.id, action: "rotate" }, coach)).status).toBe(404);
    expect((await request("/api/me/login-link", { action: "rotate" }, coach)).status).toBe(404);
    expect((await request("/api/signin-links", { userId: staff.user.id }, p.auth)).status).toBe(403);
    const adminMe = await (await request("/api/me", undefined, admin, "GET")).json() as { user: { id: string } };
    expect((await request("/api/signin-links", { userId: adminMe.user.id }, coach)).status).toBe(403);
    expect((await request("/api/player-login-links", { userId: p.id, action: "rotate" }, p.auth)).status).toBe(403);
    expect((await request("/api/registration", { action: "rotate" }, coach)).status).toBe(403);
    expect((await request(`/api/members/${p.membership}`, { role: "coach" }, admin, "PATCH")).status).toBe(200);
    expect((await request("/api/auth/login", { token: p.token })).status).toBe(401);
    expect((await request("/api/me", undefined, p.auth, "GET")).status).toBe(401);
  });

  it("blocks cross-player workouts, profile changes, and account recovery", async () => {
    const p = await player(), other = await player();
    const created = await request("/api/workouts", { type: "running", durationMin: 40, clientRequestId: "owner-only-1111" }, p.auth);
    const { workout } = await created.json() as { workout: { id: string } };
    for (const method of ["PATCH", "DELETE"]) expect([403,404]).toContain((await request(`/api/workouts/${workout.id}`, method === "PATCH" ? { type: "running", durationMin: 20 } : undefined, other.auth, method)).status);
    expect((await request(`/api/profiles/${p.profile}`, { rosterName: "Hacked" }, other.auth, "PATCH")).status).toBe(403);
    expect((await request("/api/player-login-links", { userId: p.id, action: "revoke" }, other.auth)).status).toBe(403);
    const own = await (await request("/api/workouts", undefined, other.auth, "GET")).json() as { workouts: unknown[] };
    expect(own.workouts).toHaveLength(0);
    const self = await request("/api/me/login-link", { action: "rotate", userId: p.id }, other.auth);
    expect(self.status).toBe(201);
    expect((await request("/api/auth/login", { token: p.token })).status).toBe(200);
  });

  it("allows an existing password or legacy link account to attach a new link without replacing its identity", async () => {
    const auth = await testMemberSession(env.DB, "Existing Player");
    const { user } = await (await request("/api/me", undefined, auth, "GET")).json() as { user: { id: string } };
    await env.DB.prepare("INSERT INTO credentials(user_id,username,password_hash,password_updated_at,created_at,updated_at) VALUES(?,?,?,1,1,1)").bind(user.id,"legacy.player","scrypt$legacy-retained").run();
    const result = await request("/api/me/login-link", { action: "rotate" }, auth); expect(result.status).toBe(201);
    const next = await request("/api/auth/login", { token: tokenOf((await result.json() as { url: string }).url) });
    expect((await (await request("/api/me", undefined, cookie(next), "GET")).json() as { user: { id: string } }).user.id).toBe(user.id);
    expect((await request("/api/auth/login", { username: "legacy.player", password: "anything" })).status).toBe(401);
    expect((await request("/api/auth/reset", { token: randomToken(), password: "anything" })).status).toBe(404);
  });

  it("enforces registration disable, rotation, expiry, input validation, and signed-in duplicate prevention", async () => {
    const token = await teamLink();
    expect((await register(token, { groupId: "group_forwards" })).status).toBe(400);
    expect((await register(token, { fullName: "<script>" })).status).toBe(400);
    const r = await register(token);
    expect((await request("/api/auth/register", { token }, cookie(r))).status).toBe(409);
    await request("/api/registration", { enabled: false }, admin); expect((await register(token)).status).toBe(410);
    await request("/api/registration", { enabled: true }, admin); expect((await request("/api/registration/options", { token })).status).toBe(200);
    const next = await teamLink(); expect((await register(token)).status).toBe(410);
    await env.DB.prepare("UPDATE team_registration SET expires_at=1").bind().run(); expect((await register(next)).status).toBe(410);
    expect((await request("/api/me", undefined, cookie(r), "GET")).status).toBe(200);
  });

  it("revokes links on deactivation and never revives them on reactivation", async () => {
    const p = await player();
    await request(`/api/members/${p.membership}`, { status: "deactivated" }, admin, "PATCH");
    expect((await request("/api/me", undefined, p.auth, "GET")).status).toBe(401);
    await request(`/api/members/${p.membership}`, { status: "active" }, admin, "PATCH");
    expect((await request("/api/auth/login", { token: p.token })).status).toBe(401);
  });

  it("rechecks a login token inside session insertion when revocation races a verified login", async () => {
    const p = await player(), db = env.DB;
    const batch = db.batch.bind(db);
    let revoke = true;
    vi.spyOn(db, "batch").mockImplementation(async statements => {
      if (revoke) { revoke = false; await db.prepare("DELETE FROM player_login_links WHERE user_id=?").bind(p.id).run(); }
      return batch(statements);
    });
    const response = await request("/api/auth/login", { token: p.token });
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("has generic login failures, bounded bodies, CSRF checks, hashed throttles and Retry-After", async () => {
    const p = await player();
    const first = await request("/api/auth/login", { token: randomToken() });
    expect(first.status).toBe(401);
    expect(await (await request("/api/auth/login", { token: "invalid" })).json()).toEqual(await first.json());
    expect((await request("/api/auth/login", { token: p.token }, "", "POST", { origin: "https://evil.test" })).status).toBe(403);
    expect((await request("/api/auth/login", { token: "x".repeat(9000) })).status).toBe(413);
    for (let i=0;i<60;i++) expect((await request("/api/auth/login", { token: randomToken() }, "", "POST", { "cf-connecting-ip": "192.0.2.4" })).status).toBe(401);
    const blocked = await request("/api/auth/login", { token: p.token }, "", "POST", { "cf-connecting-ip": "192.0.2.4" });
    expect(blocked.status).toBe(429); expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    const rows = await env.DB.prepare("SELECT bucket FROM auth_limits").bind().all(); expect(JSON.stringify(rows.results)).not.toContain("192.0.2.4");
  });
  it("enforces the exact login limit under concurrent attempts", async () => {
    const responses = await Promise.all(Array.from({ length: 64 }, () => request(
      "/api/auth/login", { token: randomToken() }, "", "POST", { "cf-connecting-ip": "192.0.2.77" },
    )));
    expect(responses.filter(r => r.status === 401)).toHaveLength(60);
    expect(responses.filter(r => r.status === 429)).toHaveLength(4);
    for (const response of responses.filter(r => r.status === 429)) {
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    }
  });

});
