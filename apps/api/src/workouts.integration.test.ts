import { beforeAll, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase } from "./test-db";

describe("workout scoring and leaderboards", () => {
  let env: Env;
  let player = "";
  let forwardId = "";

  beforeAll(async () => {
    env = {
      DB: openTestDatabase(),
      EMAIL_PROVIDER: "console",
      APP_ORIGIN: "http://localhost",
      BOOTSTRAP_ADMIN_EMAIL: "coach@blackthorn.test",
      EMAIL_FROM: "noreply@blackthorn.test",
    };
    const admin = await signIn("coach@blackthorn.test");
    const invited = await app.request("http://localhost/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ email: "wing@blackthorn.test", role: "player" }),
    }, env);
    expect(invited.status).toBe(201);
    player = await accept("wing@blackthorn.test");
    const options = await json<{ positions: { id: string; name: string }[] }>("/api/roster-options", player);
    const wing = options.positions.find((position) => position.name === "Left Wing");
    const onboarded = await app.request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ rosterName: "Test Wing", positionId: wing?.id, injuryStatus: "available" }),
    }, env);
    expect(onboarded.status).toBe(200);
  });

  it("scores a run, counts an identical second session, and lists both on the board", async () => {
    const first = await log({ type: "running", durationMin: 40, intensity: "moderate", distanceMiles: 5, clientRequestId: "run-one-1111" });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { awardedPointsTenths: number; workout: { distance_miles: number; points_tenths: number } };
    expect(firstBody.awardedPointsTenths).toBe(60);
    expect(firstBody.workout.distance_miles).toBe(5);
    expect(firstBody.workout.points_tenths).toBe(60);

    const retry = await log({ type: "running", durationMin: 40, clientRequestId: "run-one-1111" });
    expect(retry.status).toBe(200);
    expect((await retry.json() as { idempotent: boolean }).idempotent).toBe(true);

    const second = await log({ type: "running", durationMin: 40, clientRequestId: "run-two-2222" });
    expect((await second.json() as { awardedPointsTenths: number }).awardedPointsTenths).toBe(60);

    const board = await json<{ standings: { roster_name: string; points_tenths: number; workout_count: number; group_id: string }[] }>(
      "/api/leaderboard?period=week",
      player,
    );
    const row = board.standings.find((entry) => entry.roster_name === "Test Wing");
    expect(row?.points_tenths).toBe(120);
    expect(row?.workout_count).toBe(2);
    forwardId = row?.group_id === "group_backs" ? "group_forwards" : "";
    const forwards = await json<{ standings: { roster_name: string }[] }>("/api/leaderboard?period=week&groupId=group_forwards", player);
    expect(forwards.standings.some((entry) => entry.roster_name === "Test Wing")).toBe(false);
    const backs = await json<{ standings: { roster_name: string; position_id: string }[] }>("/api/leaderboard?period=offseason&groupId=group_backs", player);
    expect(backs.standings.some((entry) => entry.roster_name === "Test Wing")).toBe(true);
    const byPosition = await json<{ standings: { roster_name: string }[] }>(
      `/api/leaderboard?period=week&positionId=${backs.standings[0]?.position_id}`,
      player,
    );
    expect(byPosition.standings.some((entry) => entry.roster_name === "Test Wing")).toBe(true);
    expect(forwardId).toBe("group_forwards");
  });

  it("edits with a reversal and deletes without updating ledger rows", async () => {
    const created = await log({ type: "rugby", durationMin: 40, clientRequestId: "rugby-3333" });
    const createdBody = await created.json() as { workout: { id: string }; awardedPointsTenths: number };
    expect(createdBody.awardedPointsTenths).toBe(50);
    const edited = await app.request(`http://localhost/api/workouts/${createdBody.workout.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify({ type: "rugby", durationMin: 20, intensity: "moderate" }),
    }, env);
    expect(edited.status).toBe(200);
    expect((await edited.json() as { awardedPointsTenths: number }).awardedPointsTenths).toBe(25);
    const ledger = await env.DB.prepare(
      "SELECT kind, points_tenths FROM point_transactions WHERE workout_id = ? ORDER BY created_at",
    ).bind(createdBody.workout.id).all<{ kind: string; points_tenths: number }>();
    expect(ledger.results.map((row) => row.kind)).toEqual(["award", "reversal", "award"]);
    const net = ledger.results.reduce((sum, row) => sum + row.points_tenths, 0);
    expect(net).toBe(25);

    const removed = await app.request(`http://localhost/api/workouts/${createdBody.workout.id}`, {
      method: "DELETE",
      headers: { cookie: player },
    }, env);
    expect(removed.status).toBe(200);
    const history = await json<{ workouts: { id: string; status: string; review_note: string | null }[] }>("/api/workouts", player);
    const removedRow = history.workouts.find((workout) => workout.id === createdBody.workout.id);
    expect(removedRow?.status).toBe("voided");
    expect(removedRow?.review_note).toBe("Deleted by the player");
    const after = await env.DB.prepare("SELECT COALESCE(SUM(points_tenths), 0) AS net FROM point_transactions WHERE workout_id = ?").bind(createdBody.workout.id).first<{ net: number }>();
    expect(Number(after?.net)).toBe(0);
    const updates = await env.DB.prepare("SELECT COUNT(*) AS n FROM point_transactions WHERE workout_id = ? AND kind = 'award'").bind(createdBody.workout.id).first<{ n: number }>();
    expect(updates?.n).toBe(2);
  });

  it("rejects client-supplied points", async () => {
    const response = await log({ type: "football", durationMin: 30, points: 99 });
    expect(response.status).toBe(400);
  });

  async function log(body: Record<string, unknown>): Promise<Response> {
    return app.request("http://localhost/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: player },
      body: JSON.stringify(body),
    }, env);
  }

  async function json<T>(path: string, cookie: string): Promise<T> {
    const response = await app.request(`http://localhost${path}`, { headers: { cookie } }, env);
    expect(response.status).toBe(200);
    return response.json() as Promise<T>;
  }

  async function signIn(email: string): Promise<string> {
    await app.request("http://localhost/api/auth/request", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${email.length}` },
      body: JSON.stringify({ email }),
    }, env);
    return accept(email);
  }

  async function accept(email: string): Promise<string> {
    const mailbox = await app.request(`http://localhost/api/dev/mailbox?to=${encodeURIComponent(email)}`, {}, env);
    const body = await mailbox.json() as { messages: { text_body: string }[] };
    const link = body.messages[0]?.text_body.match(/http:\/\/localhost\S+/)?.[0];
    if (!link) throw new Error(`No link for ${email}`);
    const verified = await app.request(link, {}, env);
    const header = verified.headers.get("set-cookie");
    if (!header) throw new Error("Missing cookie");
    return header.split(";")[0] ?? "";
  }
});
