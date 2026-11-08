import { beforeAll, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase, testMemberSession } from "./test-db";

describe("coach logging and dashboards", () => {
  let env: Env;
  let coach = "";

  beforeAll(async () => {
    env = {
      DB: openTestDatabase(),
      EMAIL_PROVIDER: "none",
      APP_ORIGIN: "http://localhost",
    };
    coach = await signIn("coach@blackthorn.test");
  });

  it("lets a coach log without a position and keeps them off the forwards board", async () => {
    const created = await app.request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: coach },
      body: JSON.stringify({ rosterName: "Coach Kim", injuryStatus: "available" }),
    }, env);
    expect(created.status).toBe(200);
    const bounds = await json<{ today: string; minDate: string }>("/api/workouts", coach);
    const tooOld = await app.request("http://localhost/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: coach },
      body: JSON.stringify({ type: "running", durationMin: 30, occurredOn: "2026-01-01", clientRequestId: "old-run-1111" }),
    }, env);
    expect(tooOld.status).toBe(400);
    const logged = await app.request("http://localhost/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: coach },
      body: JSON.stringify({ type: "running", durationMin: 40, occurredOn: bounds.today, clientRequestId: "coach-run-2222" }),
    }, env);
    expect(logged.status).toBe(201);
    const everyone = await json<{ standings: { roster_name: string; movement: number | null }[] }>("/api/leaderboard?period=week", coach);
    expect(everyone.standings.some((row) => row.roster_name === "Coach Kim")).toBe(true);
    const forwards = await json<{ standings: { roster_name: string }[] }>("/api/leaderboard?period=week&groupId=group_forwards", coach);
    expect(forwards.standings.some((row) => row.roster_name === "Coach Kim")).toBe(false);
    const coaches = await json<{ standings: { roster_name: string }[] }>("/api/leaderboard?period=month&groupId=coaches", coach);
    expect(coaches.standings.some((row) => row.roster_name === "Coach Kim")).toBe(true);
    const dash = await json<{ week: { pointsTenths: number }; streak: number; byType: { type: string }[] }>("/api/dashboard", coach);
    expect(dash.week.pointsTenths).toBeGreaterThan(0);
    expect(dash.streak).toBeGreaterThan(0);
    expect(dash.byType.some((row) => row.type === "running")).toBe(true);
    const team = await json<{ participation: { active: number; rate: number }; movers: { rosterName: string; delta: number }[] }>("/api/team", coach);
    expect(team.participation.active).toBe(1);
    expect(team.participation.rate).toBe(1);
    expect(team.movers[0]?.rosterName).toBe("Coach Kim");
    expect(team.movers[0]?.delta).toBeGreaterThan(0);
  });

  it("refuses a player profile with no position", async () => {
    const player = await accept("rookie@blackthorn.test");
    const response = await app.request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ rosterName: "Rookie", injuryStatus: "available" }),
    }, env);
    expect(response.status).toBe(400);
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
