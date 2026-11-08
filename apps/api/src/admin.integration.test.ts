import { beforeAll, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase, testMemberSession } from "./test-db";

describe("coach admin tools", () => {
  let env: Env;
  let admin = "";
  let coach = "";
  let player = "";
  let workoutId = "";
  let profileId = "";

  beforeAll(async () => {
    env = {
      DB: openTestDatabase(),
      EMAIL_PROVIDER: "none",
      APP_ORIGIN: "http://localhost",
    };
    admin = await signIn("coach@blackthorn.test");
    coach = await accept("assistant@blackthorn.test");
    player = await accept("wing@blackthorn.test");
    const options = await json<{ positions: { id: string; name: string }[] }>("/api/roster-options", player);
    const wing = options.positions.find((position) => position.name === "Left Wing");
    await app.request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ rosterName: "Test Wing", positionId: wing?.id, injuryStatus: "available" }),
    }, env);
    const onboarded = await app.request("http://localhost/api/me", { headers: { cookie: player } }, env);
    profileId = ((await onboarded.json()) as { profile: { id: string } }).profile.id;
    const logged = await app.request("http://localhost/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ type: "running", durationMin: 40, clientRequestId: "admin-run-1111" }),
    }, env);
    const body = await logged.json() as { workout: { id: string } };
    workoutId = body.workout.id;
  });

  it("forbids a player from coach tools", async () => {
    for (const [method, path] of [
      ["GET", "/api/moderation"],
      ["POST", `/api/moderation/${workoutId}`],
      ["GET", "/api/members"],
      ["POST", "/api/rules"],
      ["PATCH", "/api/season"],
      ["GET", "/api/audit"],
      ["GET", "/api/export/workouts.csv"],
      ["POST", "/api/adjustments"],
      ["PATCH", "/api/members/missing"],
      ["POST", "/api/invitations/missing/resend"],
    ] as const) {
      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: { cookie: player, "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      }, env);
      expect(response.status).toBe(403);
    }
    const signedOut = await app.request("http://localhost/api/moderation", {}, env);
    expect(signedOut.status).toBe(401);
  });

  it("lets a coach moderate and blocks admin-only changes", async () => {
    const queue = await app.request("http://localhost/api/moderation", { headers: { cookie: coach } }, env);
    expect(queue.status).toBe(200);
    const csv = await app.request("http://localhost/api/export/workouts.csv", { headers: { cookie: coach } }, env);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const held = await app.request(`http://localhost/api/profiles/${profileId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: coach },
      body: JSON.stringify({ injuryStatus: "out", injuryNote: "Ankle" }),
    }, env);
    expect(held.status).toBe(200);
    const moved = await app.request(`http://localhost/api/profiles/${profileId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: coach },
      body: JSON.stringify({ clearPosition: true }),
    }, env);
    expect(moved.status).toBe(200);
    const members = await json<{ members: { profile_id: string; injury_status: string; injury_note: string | null; position_id: string | null }[] }>("/api/members", coach);
    const wing = members.members.find((member) => member.profile_id === profileId);
    expect(wing?.injury_status).toBe("out");
    expect(wing?.injury_note).toBe("Ankle");
    expect(wing?.position_id).toBeNull();
    for (const [method, path, body] of [
      ["POST", "/api/rules", { effectiveOn: "2027-02-01", dailyCapTenths: 1, sessionCapTenths: 1, weeklyLoadLimit: 1 }],
      ["PATCH", "/api/season", { name: "Nope", startOn: "2026-11-08", endOn: "2027-04-30" }],
      ["POST", "/api/adjustments", { profileId, pointsTenths: 10, reason: "Coach bonus", occurredOn: "2026-11-08" }],
      ["PATCH", "/api/members/missing", { role: "admin" }],
    ] as const) {
      const response = await app.request(`http://localhost${path}`, {
        method,
        headers: { cookie: coach, "content-type": "application/json" },
        body: JSON.stringify(body),
      }, env);
      expect(response.status).toBe(403);
    }
  });

  it("voids a workout, drops the board, and shows the reason to the player", async () => {
    const before = await json<{ standings: { roster_name: string; points_tenths: number }[] }>("/api/leaderboard?period=week", player);
    expect(before.standings.find((row) => row.roster_name === "Test Wing")?.points_tenths).toBe(60);
    const removed = await app.request(`http://localhost/api/moderation/${workoutId}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ action: "void", reason: "Duplicate of practice" }),
    }, env);
    expect(removed.status).toBe(200);
    const after = await json<{ standings: { roster_name: string; points_tenths: number }[] }>("/api/leaderboard?period=week", player);
    expect(after.standings.find((row) => row.roster_name === "Test Wing")?.points_tenths ?? 0).toBe(0);
    const history = await json<{ workouts: { id: string; status: string; review_note: string | null }[] }>("/api/workouts", player);
    const row = history.workouts.find((workout) => workout.id === workoutId);
    expect(row?.status).toBe("voided");
    expect(row?.review_note).toBe("Duplicate of practice");
    const ledger = await env.DB.prepare("SELECT kind FROM point_transactions WHERE workout_id = ? ORDER BY created_at").bind(workoutId).all<{ kind: string }>();
    expect(ledger.results.map((entry) => entry.kind)).toContain("reversal");
    const restored = await app.request(`http://localhost/api/moderation/${workoutId}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ action: "restore", reason: "It counts" }),
    }, env);
    expect(restored.status).toBe(200);
    const back = await json<{ standings: { points_tenths: number; roster_name: string }[] }>("/api/leaderboard?period=week", player);
    expect(back.standings.find((entry) => entry.roster_name === "Test Wing")?.points_tenths).toBe(60);
    const day = history.workouts.find((workout) => workout.id === workoutId);
    const occurredOn = (await json<{ workouts: { id: string; occurred_on: string }[] }>("/api/workouts", player)).workouts.find((workout) => workout.id === workoutId)?.occurred_on;
    const adjusted = await app.request("http://localhost/api/adjustments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ profileId, pointsTenths: 10, reason: "Captain's bonus", occurredOn }),
    }, env);
    expect(adjusted.status).toBe(201);
    const withBonus = await json<{ standings: { roster_name: string; points_tenths: number }[] }>("/api/leaderboard?period=week", player);
    expect(withBonus.standings.find((entry) => entry.roster_name === "Test Wing")?.points_tenths).toBe(70);
    const audit = await json<{ events: { action: string }[] }>("/api/audit?action=workout_void", admin);
    expect(audit.events.some((event) => event.action === "workout_void")).toBe(true);
    expect(day?.review_note).toBe("Duplicate of practice");
  });

  it("keeps the last admin and leaves the ledger alone when the offseason changes", async () => {
    const members = await json<{ members: { membership_id: string; role: string }[] }>("/api/members", admin);
    const adminMember = members.members.find((member) => member.role === "admin");
    const blocked = await app.request(`http://localhost/api/members/${adminMember?.membership_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ status: "deactivated" }),
    }, env);
    expect(blocked.status).toBe(409);
    const before = await env.DB.prepare("SELECT id, points_tenths, kind FROM point_transactions ORDER BY created_at").bind().all();
    const season = await app.request("http://localhost/api/season", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ name: "Offseason 2026-27", startOn: "2026-11-08", endOn: "2027-05-15" }),
    }, env);
    expect(season.status).toBe(200);
    const after = await env.DB.prepare("SELECT id, points_tenths, kind FROM point_transactions ORDER BY created_at").bind().all();
    expect(after.results).toEqual(before.results);
  });

  it("schedules a rule without rewriting the existing ledger", async () => {
    const before = await env.DB.prepare("SELECT points_tenths, kind FROM point_transactions WHERE workout_id = ?").bind(workoutId).all();
    const created = await app.request("http://localhost/api/rules", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ dailyCapTenths: 200, sessionCapTenths: 100, weeklyLoadLimit: 500, effectiveOn: "2027-01-01" }),
    }, env);
    expect(created.status).toBe(201);
    expect((await created.json() as { status: string }).status).toBe("draft");
    const after = await env.DB.prepare("SELECT points_tenths, kind FROM point_transactions WHERE workout_id = ?").bind(workoutId).all();
    expect(after.results).toEqual(before.results);
  });

  it("exports workouts as csv", async () => {
    const response = await app.request("http://localhost/api/export/workouts.csv", { headers: { cookie: admin } }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const text = await response.text();
    expect(text).toContain("Test Wing");
    expect(text).toContain("running");
  });

  async function json<T>(path: string, cookie: string): Promise<T> {
    const response = await app.request(`http://localhost${path}`, { headers: { cookie } }, env);
    expect(response.status).toBe(200);
    return response.json() as Promise<T>;
  }

  async function signIn(label: string): Promise<string> {
    return testMemberSession(env.DB, label, "admin");
  }

  async function accept(label: string): Promise<string> {
    return testMemberSession(env.DB, label, label.startsWith("assistant") ? "coach" : "player");
  }
});
