import { beforeEach, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase } from "./test-db";
import { hashPassword, verifyPassword } from "./passwords";

const password = "rugby training passphrase";
describe("email-free team accounts", () => {
  let env: Env, admin: string;
  const cookie = (r: Response) => r.headers.get("set-cookie")?.split(";")[0] ?? "";
  async function request(path: string, body?: unknown, auth = "", method = "POST", extra: Record<string, string> = {}) {
    return app.request("https://club.test" + path, { method, headers: { "content-type": "application/json", ...(auth ? { cookie: auth } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  }
  async function link() {
    const r = await request("/api/registration", { action: "rotate" }, admin);
    expect(r.status).toBe(201);
    return new URL((await r.json() as { url: string }).url).hash.slice(7);
  }
  async function register(token: string, username = "wing.one", extra: Record<string, unknown> = {}) {
    return request("/api/auth/register", { token, username, fullName: "Test Wing", password, confirmPassword: password, positionId: "pos_fullback", groupId: "group_backs", ...extra });
  }
  beforeEach(async () => {
    env = { DB: openTestDatabase(), BOOTSTRAP_TOKEN: "test-setup", EMAIL_PROVIDER: "none" };
    const r = await request("/api/setup", { name: "Coach", token: "test-setup" });
    admin = cookie(r);
  });

  it("stores salted, versioned hashes and verifies correct passwords only", async () => {
    const a = await hashPassword(password), b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(a).not.toContain(password);
    expect(a).toMatch(/^scrypt\$1\$32768\$8\$3\$/);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword("incorrect password", a)).toBe(false);
    expect(await verifyPassword(password, null)).toBe(false);
    expect(await verifyPassword(password, "invalid")).toBe(false);
  });

  it("registers multiple players from one permanent link, fixes roles, and normalizes usernames", async () => {
    const token = await link();
    const first = await register(token, "Wing.One", { role: "admin", status: "invited", points: 9000 });
    expect(first.status).toBe(201);
    expect(first.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(first.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(first.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(first.headers.get("set-cookie")).toMatch(/Max-Age=15552000/i);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const me = await request("/api/me", undefined, cookie(first), "GET");
    const player = await me.json() as { membership: { role: string }; needsOnboarding: boolean; pendingApproval: boolean; user: { email: string } };
    expect(player.membership.role).toBe("player");
    expect(player.needsOnboarding).toBe(false);
    expect(player.pendingApproval).toBe(false);
    expect(player.user.email).toBe("");
    expect((await register(token, "second.wing")).status).toBe(201);
    expect((await register(token, "WING.ONE")).status).toBe(409);
    const users = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").bind().first<{ n: number }>();
    expect(users?.n).toBe(3); // no orphan user from the duplicate
    await expect(env.DB.prepare("INSERT INTO credentials(user_id,username,created_at,updated_at) VALUES('not-real','WING.ONE',0,0)").bind().run()).rejects.toThrow();
    const stored = await env.DB.prepare("SELECT token_hash FROM team_registration").bind().first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(token);
  });

  it("validates public registration, expiry, disable and rotation without affecting accounts", async () => {
    const token = await link();
    expect((await register("invalid")).status).toBe(410);
    expect((await register(token, "bad username")).status).toBe(400);
    expect((await register(token, "test", { password: "short", confirmPassword: "short" })).status).toBe(400);
    expect((await register(token, "test", { confirmPassword: "different" })).status).toBe(400);
    expect((await register(token, "test", { groupId: "group_forwards" })).status).toBe(400);
    expect((await register(token, "test", { fullName: "<script>alert(1)</script>" })).status).toBe(400);
    const r = await register(token);
    await request("/api/registration", { enabled: false }, admin);
    expect((await register(token, "disabled")).status).toBe(410);
    await request("/api/registration", { enabled: true }, admin);
    expect((await request("/api/registration/options", { token })).status).toBe(200);
    const next = await link();
    expect((await register(token, "rotated")).status).toBe(410);
    expect((await request("/api/me", undefined, cookie(r), "GET")).status).toBe(200);
    await env.DB.prepare("UPDATE team_registration SET expires_at=1").bind().run();
    expect((await register(next, "expired")).status).toBe(410);
  });

  it("logs in on a new device, uses generic failures, revokes replaced sessions and logs out", async () => {
    const created = await register(await link());
    const auth = cookie(created);
    for (const input of [{ username: "wing.one", password: "wrong" }, { username: "absent", password }]) {
      const r = await request("/api/auth/login", input);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "Username or password is incorrect." });
    }
    const login = await request("/api/auth/login", { username: "WING.ONE", password }, auth);
    expect(login.status).toBe(200);
    expect(cookie(login)).not.toBe(auth);
    expect((await request("/api/me", undefined, auth, "GET")).status).toBe(401);
    const second = await request("/api/auth/login", { username: "wing.one", password });
    expect(second.status).toBe(200);
    await request("/api/auth/logout", {}, cookie(login));
    expect((await request("/api/me", undefined, cookie(login), "GET")).status).toBe(401);
    expect((await request("/api/me", undefined, cookie(second), "GET")).status).toBe(200);
    const hash = cookie(second).split("=")[1]!;
    const { sha256Hex } = await import("./tokens");
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").bind(Date.now()+1000, await sha256Hex(hash)).run();
    const slid = await request("/api/me", undefined, cookie(second), "GET");
    expect(slid.headers.get("set-cookie")).toContain("Max-Age=15552000");
  });

  it("enforces admin boundaries, CSRF, body limits, and deactivation", async () => {
    const created = await register(await link());
    const player = cookie(created);
    for (const path of ["/api/registration", "/api/password-resets"]) {
      expect((await request(path, { action: "rotate", userId: "x" })).status).toBe(401);
      expect((await request(path, { action: "rotate", userId: "x" }, player)).status).toBe(403);
    }
    expect((await request("/api/registration", undefined, player, "GET")).status).toBe(403);
    expect((await request("/api/members", undefined, player, "GET")).status).toBe(403);
    expect((await request("/api/auth/login", { username: "wing.one", password }, "", "POST", { origin: "https://evil.test" })).status).toBe(403);
    expect((await request("/api/auth/register", { token: "a".repeat(9000) })).status).toBe(413);
    await env.DB.prepare("UPDATE club_memberships SET status='deactivated' WHERE role='player'").bind().run();
    expect((await request("/api/auth/login", { username: "wing.one", password })).status).toBe(401);
    expect((await request("/api/me", undefined, player, "GET")).status).toBe(401);
  });

  it("limits login by account across IPs and registration by IP", async () => {
    const token = await link();
    // Pre-fill the atomic buckets rather than paying for 15 intentional hash verifications.
    const { sha256Hex } = await import("./tokens");
    const start = Math.floor(Date.now()/900000)*900000;
    await env.DB.prepare("INSERT INTO auth_limits(bucket,window_start,attempts) VALUES(?,?,15)").bind("login-account:"+await sha256Hex("target"),start).run();
    expect((await request("/api/auth/login", { username: "target", password }, "", "POST", { "cf-connecting-ip": "203.0.113.1" })).status).toBe(429);
    expect((await request("/api/auth/login", { username: "target", password }, "", "POST", { "cf-connecting-ip": "203.0.113.2" })).status).toBe(429);
    for (let i=0;i<10;i++) await request("/api/auth/register", { token: "invalid" });
    const limited = await register(token);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("resets passwords once, rejects expired/replaced links, and revokes sessions and legacy sign-in links", async () => {
    const created = await register(await link());
    const player = cookie(created);
    const me = await (await request("/api/me", undefined, player, "GET")).json() as { user: { id: string } };
    const legacy = await request("/api/signin-links", {}, player);
    const legacyUrl = (await legacy.json() as { url: string }).url;
    const makeReset = async () => {
      const r = await request("/api/password-resets", { userId: me.user.id }, admin);
      expect(r.status).toBe(201);
      return new URL((await r.json() as { url: string }).url).hash.slice(7);
    };
    const old = await makeReset(), token = await makeReset();
    expect((await request("/api/auth/reset", { token: old, password, confirmPassword: password })).status).toBe(410);
    const next = "another rugby passphrase";
    const reset = await request("/api/auth/reset", { token, password: next, confirmPassword: next });
    expect(reset.status).toBe(200);
    expect(reset.headers.get("set-cookie")).toBeNull();
    expect((await request("/api/me", undefined, player, "GET")).status).toBe(401);
    expect((await request("/api/auth/reset", { token, password: next, confirmPassword: next })).status).toBe(410);
    expect((await app.request(legacyUrl, {}, env)).headers.get("location")).toContain("expired");
    expect((await request("/api/auth/login", { username: "wing.one", password })).status).toBe(401);
    expect((await request("/api/auth/login", { username: "wing.one", password: next })).status).toBe(200);
    const expired = await makeReset();
    await env.DB.prepare("UPDATE password_resets SET expires_at=1").bind().run();
    expect((await request("/api/auth/reset/options", { token: expired })).status).toBe(410);
  });

  it("migrates a legacy player in place and keeps training data and credentials stable", async () => {
    const invite = await request("/api/share-invites", { label: "Legacy Wing", role: "player" }, admin);
    const joined = await app.request((await invite.json() as { url: string }).url, {}, env);
    let auth = cookie(joined);
    await request("/api/onboarding", { rosterName: "Legacy Wing", positionId: "pos_fullback", injuryStatus: "available" }, auth);
    const workouts = await (await request("/api/workouts", undefined, auth, "GET")).json() as { today: string };
    expect((await request("/api/workouts", { type: "running", durationMin: 40, occurredOn: workouts.today, intensity: "moderate", clientRequestId: crypto.randomUUID() }, auth)).status).toBe(201);
    const before = await (await request("/api/me", undefined, auth, "GET")).json();
    const migrated = await request("/api/me/credentials", { username: "legacy.wing", password, confirmPassword: password }, auth);
    expect(migrated.status).toBe(200);
    expect((await request("/api/me", undefined, auth, "GET")).status).toBe(401);
    auth = cookie(migrated);
    expect(await (await request("/api/me", undefined, auth, "GET")).json()).toEqual(before);
    const dash = await (await request("/api/dashboard", undefined, auth, "GET")).json() as { offseason: { pointsTenths: number } };
    expect(dash.offseason.pointsTenths).toBe(60);
    const badges = await (await request("/api/badges", undefined, auth, "GET")).json() as { badges: { key: string; awarded_at: number | null; progress: { current: number; target: number } }[] };
    expect(badges.badges.find(b => b.key === "points_50")?.progress).toMatchObject({ current: 6, target: 50 });
    expect(badges.badges.find(b => b.key === "first_session")?.awarded_at).toBeTruthy();
    expect((await request("/api/me/credentials", { username: "hijack", password, confirmPassword: password }, auth)).status).toBe(409);
  });
});
