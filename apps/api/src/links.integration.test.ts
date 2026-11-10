import { beforeAll, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase } from "./test-db";

describe("shareable links", () => {
  let env: Env;
  let admin = "";

  beforeAll(async () => {
    env = {
      DB: openTestDatabase(),
      EMAIL_PROVIDER: "none",
      APP_ORIGIN: "http://localhost",
      BOOTSTRAP_TOKEN: "setup-token",
      AUTH_LINK_LIMIT: "8",
      AUTH_REDEEM_LIMIT: "8",
    };
    const setup = await app.request("http://localhost/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "setup-token", name: "Coach" }),
    }, env);
    expect(setup.status).toBe(200);
    admin = cookie(setup);
  });

  it("disables setup after the first admin", async () => {
    const again = await app.request("http://localhost/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "setup-token", name: "Other" }),
    }, env);
    expect(again.status).toBe(409);
    const off = await app.request("http://localhost/api/auth/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "coach@blackthorn.test" }),
    }, env);
    expect(off.status).toBe(410);
  });

  it("redeems a one-time invite into onboarding and rejects a second use", async () => {
    const created = await app.request("http://localhost/api/share-invites", {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ label: "Alex Wing", role: "player" }),
    }, env);
    expect(created.status).toBe(201);
    const url = ((await created.json()) as { url: string }).url;
    const redeemed = await app.request(url, {}, env);
    expect(redeemed.status).toBe(302);
    expect(redeemed.headers.get("location")).toBe("/onboarding");
    const player = cookie(redeemed);
    const me = await app.request("http://localhost/api/me", { headers: { cookie: player } }, env);
    expect((await me.json() as { needsOnboarding: boolean }).needsOnboarding).toBe(true);
    const again = await app.request(url, {}, env);
    expect(again.headers.get("location")).toContain("expired");
    const audit = await env.DB.prepare("SELECT action FROM audit_events WHERE action = 'invite_link_redeemed'").bind().all<{ action: string }>();
    expect(audit.results.length).toBeGreaterThan(0);
  });

  it("lets a club link land as pending and blocks a player from minting someone else's sign-in link", async () => {
    const club = await app.request("http://localhost/api/join-link", {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ landing: "pending", days: 7 }),
    }, env);
    expect(club.status).toBe(201);
    const url = ((await club.json()) as { url: string }).url;
    const joined = await app.request(url, {}, env);
    expect(joined.headers.get("location")).toBe("/pending");
    const pending = cookie(joined);
    const me = await app.request("http://localhost/api/me", { headers: { cookie: pending } }, env);
    const body = await me.json() as { pendingApproval: boolean; user: { id: string } };
    expect(body.pendingApproval).toBe(true);
    const stolen = await app.request("http://localhost/api/signin-links", {
      method: "POST",
      headers: { cookie: pending, "content-type": "application/json" },
      body: JSON.stringify({ userId: "someone-else" }),
    }, env);
    expect(stolen.status).toBe(403);
    const members = await app.request("http://localhost/api/members", { headers: { cookie: admin } }, env);
    const roster = await members.json() as { members: { membership_id: string; user_status: string }[] };
    const row = roster.members.find((member) => member.user_status === "invited");
    const approved = await app.request(`http://localhost/api/members/${row?.membership_id}`, {
      method: "PATCH",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ approve: true }),
    }, env);
    expect(approved.status).toBe(200);
    const disabled = await app.request("http://localhost/api/join-link/disable", { method: "POST", headers: { cookie: admin } }, env);
    expect(disabled.status).toBe(200);
    const closed = await app.request(url, {}, env);
    expect(closed.headers.get("location")).toContain("expired");
  });

  it("issues a single-use recovery link and blocks a cross-site post", async () => {
    const created = await app.request("http://localhost/api/signin-links", {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: "{}",
    }, env);
    expect(created.status).toBe(201);
    const url = ((await created.json()) as { url: string }).url;
    const signed = await app.request(url, {}, env);
    expect(signed.status).toBe(302);
    expect(cookie(signed)).toContain("blackthorn_session=");
    const reused = await app.request(url, {}, env);
    expect(reused.headers.get("location")).toContain("expired");
    const cross = await app.request("http://localhost/api/signin-links", {
      method: "POST",
      headers: { cookie: admin, origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    }, env);
    expect(cross.status).toBe(403);
    const health = await app.request("http://localhost/health", {}, env);
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  function cookie(response: Response): string {
    return response.headers.get("set-cookie")?.split(";")[0] ?? "";
  }
});
