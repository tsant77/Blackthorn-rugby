import { beforeAll, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase } from "./test-db";

describe("magic links and onboarding", () => {
  let env: Env;

  beforeAll(() => {
    const db = openTestDatabase();
    env = {
      DB: db as unknown as D1Database,
      EMAIL_PROVIDER: "console",
      APP_ORIGIN: "http://localhost",
      BOOTSTRAP_ADMIN_EMAIL: "coach@blackthorn.test",
      EMAIL_FROM: "noreply@blackthorn.test",
    };
  });

  it("does not send mail for an unknown address", async () => {
    const response = await post("/api/auth/request", { email: "stranger@example.com" }, "203.0.113.5");
    expect(response.status).toBe(200);
    const mailbox = await getJson(`/api/dev/mailbox?to=${encodeURIComponent("stranger@example.com")}`);
    expect(mailbox.messages).toEqual([]);
  });

  it("signs in the bootstrap admin from a magic link", async () => {
    const response = await post("/api/auth/request", { email: "coach@blackthorn.test" }, "203.0.113.8");
    expect(response.status).toBe(200);
    const link = await latestLink("coach@blackthorn.test");
    const verified = await app.request(link, { headers: { "x-forwarded-for": "203.0.113.8" } }, env);
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe("/");
    const me = await app.request("http://localhost/api/me", { headers: { cookie: cookieOf(verified) } }, env);
    const body = await me.json() as { membership: { role: string }; needsOnboarding: boolean };
    expect(body.membership.role).toBe("admin");
    expect(body.needsOnboarding).toBe(false);
  });

  it("invites a player, accepts the link, and finishes onboarding", async () => {
    const admin = await signIn("coach@blackthorn.test", "203.0.113.9");
    const invited = await app.request("http://localhost/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ email: "player@blackthorn.test", role: "player" }),
    }, env);
    expect(invited.status).toBe(201);
    const link = await latestLink("player@blackthorn.test");
    expect(link).toContain("/auth/invite?token=");
    const accepted = await app.request(link, {}, env);
    expect(accepted.headers.get("location")).toBe("/onboarding");
    const player = cookieOf(accepted);
    const options = await app.request("http://localhost/api/roster-options", { headers: { cookie: player } }, env);
    const catalog = await options.json() as { positions: { id: string; name: string; group_name: string }[] };
    const loosehead = catalog.positions.find((position) => position.name === "Loosehead Prop");
    expect(loosehead?.group_name).toBe("Forwards");
    const onboarded = await app.request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({
        rosterName: "Alex Wing",
        positionId: loosehead?.id,
        injuryStatus: "available",
      }),
    }, env);
    expect(onboarded.status).toBe(200);
    const me = await app.request("http://localhost/api/me", { headers: { cookie: player } }, env);
    const body = await me.json() as {
      needsOnboarding: boolean;
      profile: { id: string; rosterName: string; groupId: string };
    };
    expect(body.needsOnboarding).toBe(false);
    expect(body.profile.rosterName).toBe("Alex Wing");
    expect(body.profile.groupId).toBe("group_forwards");

    const denied = await app.request("http://localhost/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ email: "other@blackthorn.test", role: "player" }),
    }, env);
    expect(denied.status).toBe(403);

    const ownInjury = await app.request("http://localhost/api/me/injury", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ injuryStatus: "limited", injuryNote: "Hamstring" }),
    }, env);
    expect(ownInjury.status).toBe(200);

    const coachInjury = await app.request(`http://localhost/api/squad/${body.profile.id}/injury`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ injuryStatus: "out", injuryNote: "Coach hold" }),
    }, env);
    expect(coachInjury.status).toBe(200);
    const squad = await app.request("http://localhost/api/squad", { headers: { cookie: admin } }, env);
    const squadBody = await squad.json() as { players: { roster_name: string; injury_status: string }[] };
    expect(squadBody.players.some((player) => player.roster_name === "Alex Wing" && player.injury_status === "out")).toBe(true);
  });

  it("rate limits repeated sign-in requests", async () => {
    const headers = { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.request("http://localhost/api/auth/request", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "rate@blackthorn.test" }),
      }, env);
      expect(response.status).toBe(200);
    }
    const blocked = await app.request("http://localhost/api/auth/request", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "rate@blackthorn.test" }),
    }, env);
    expect(blocked.status).toBe(429);
  });

  it("hides the dev mailbox unless the console provider is selected", async () => {
    const hidden = await app.request("http://localhost/api/dev/mailbox?to=coach@blackthorn.test", {}, {
      ...env,
      EMAIL_PROVIDER: "cloudflare",
    });
    expect(hidden.status).toBe(404);
  });

  async function post(path: string, body: unknown, ip: string): Promise<Response> {
    return app.request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }, env);
  }

  async function getJson(path: string): Promise<{ messages: { text_body: string }[] }> {
    const response = await app.request(`http://localhost${path}`, {}, env);
    return response.json();
  }

  async function latestLink(email: string): Promise<string> {
    const mailbox = await getJson(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
    const text = mailbox.messages[0]?.text_body ?? "";
    const match = text.match(/http:\/\/localhost\S+/);
    if (!match) throw new Error(`No link for ${email}`);
    return match[0];
  }

  async function signIn(email: string, ip: string): Promise<string> {
    await post("/api/auth/request", { email }, ip);
    const verified = await app.request(await latestLink(email), { headers: { "x-forwarded-for": ip } }, env);
    return cookieOf(verified);
  }

  function cookieOf(response: Response): string {
    const header = response.headers.get("set-cookie");
    if (!header) throw new Error("Missing session cookie");
    return header.split(";")[0] ?? "";
  }
});
