import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRule } from "@blackthorn/scoring";
import app, { type Env } from "./app";
import { openTestDatabase, testMemberSession } from "./test-db";

const clock = (date: string) => vi.setSystemTime(new Date(date + "T17:00:00Z"));
describe("fitness rules and immutable awards", () => {
  let env: Env,
    admin: string,
    coach: string,
    player: string,
    profile: string,
    oldId: string,
    sequence: number;
  async function request(
    path: string,
    body?: unknown,
    cookie = player,
    method = "POST",
  ) {
    return app.request(
      "https://club.test" + path,
      {
        method,
        headers: { "content-type": "application/json", cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  }
  async function json<T>(path: string, cookie = player): Promise<T> {
    const r = await request(path, undefined, cookie, "GET");
    expect(r.status).toBe(200);
    return r.json() as Promise<T>;
  }
  async function publish(config = defaultRule(), date = "2026-11-16") {
    const latest = await env.DB.prepare(
      "SELECT MAX(version) AS n FROM scoring_rule_versions",
    )
      .bind()
      .first<{ n: number }>();
    return request(
      "/api/scoring-settings",
      { config, effectiveOn: date, expectedVersion: latest!.n },
      admin,
    );
  }
  async function log(date: string, extra: Record<string, unknown> = {}) {
    return request("/api/workouts", {
      type: "running",
      durationMin: 20,
      occurredOn: date,
      clientRequestId: `fitness-log-${sequence++}`,
      ...extra,
    });
  }
  async function bonus() {
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(points_tenths),0) AS n FROM point_transactions WHERE player_profile_id=? AND reason_code='weekly_consistency'",
    )
      .bind(profile)
      .first<{ n: number }>();
    return row!.n;
  }
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    clock("2026-11-16");
    sequence = 0;
    env = { DB: openTestDatabase(), EMAIL_PROVIDER: "none" };
    admin = await testMemberSession(env.DB, "Scoring Admin", "admin");
    coach = await testMemberSession(env.DB, "Scoring Coach", "coach");
    player = await testMemberSession(env.DB, "Fitness Player");
    expect(
      (
        await request("/api/onboarding", {
          rosterName: "Fitness Player",
          positionId: "pos_fullback",
          injuryStatus: "available",
        })
      ).status,
    ).toBe(200);
    profile = (await json<{ profile: { id: string } }>("/api/me")).profile.id;
    const old = await log("2026-11-15", { durationMin: 40 });
    expect(old.status).toBe(201);
    oldId = ((await old.json()) as { workout: { id: string } }).workout.id;
    expect((await publish()).status).toBe(201);
    clock("2026-11-22");
  });
  afterEach(() => vi.useRealTimers());
  it("uses the earliest legacy rule for a week before any effective date without adding bonuses", async () => {
    clock("2026-11-08");
    expect((await log("2026-11-08")).status).toBe(201);
    const snapshot = await env.DB.prepare(
      "SELECT rule_id,rule_json,points_tenths FROM weekly_consistency WHERE profile_id=? AND week_start='2026-11-02'",
    ).bind(profile).first<{ rule_id: string; rule_json: string; points_tenths: number }>();
    expect(snapshot?.rule_id).toBe("rule_v1");
    expect(JSON.parse(snapshot!.rule_json)).toEqual({ consistency: [], consistencyMinMinutes: 20 });
    expect(snapshot?.points_tenths).toBe(0);
    expect(await bonus()).toBe(0);
  });
  it("publishes fitness rates prospectively and preserves old awards and their scoring version", async () => {
    expect((await log("2026-11-22")).status).toBe(201);
    const rows = await json<{
      workouts: { id: string; points_tenths: number }[];
    }>("/api/workouts");
    expect(rows.workouts.find((w) => w.id === oldId)?.points_tenths).toBe(60);
    expect(rows.workouts.find((w) => w.id !== oldId)?.points_tenths).toBe(200);
    const config = defaultRule();
    config.types.running!.multiplierHundredths = 2000;
    expect((await publish(config, "2026-11-23")).status).toBe(201);
    expect((await log("2026-11-23")).status).toBe(400);
    clock("2026-11-23");
    const newWorkout = await log("2026-11-23");
    expect(
      ((await newWorkout.json()) as { awardedPointsTenths: number })
        .awardedPointsTenths,
    ).toBe(400);
    const edit = await request(
      `/api/workouts/${oldId}`,
      { type: "running", durationMin: 20, occurredOn: "2026-11-16" },
      player,
      "PATCH",
    );
    // Still the original v1 formula, despite the new date and two later versions.
    expect(edit.status).toBe(200);
    expect(
      ((await edit.json()) as { awardedPointsTenths: number })
        .awardedPointsTenths,
    ).toBe(30);
  });
  it("awards only the highest tier and reverses bonuses after edit, delete, reject, void, and restore", async () => {
    const ids: string[] = [];
    for (const day of [16, 17, 18, 19, 20]) {
      const r = await log(`2026-11-${day}`);
      expect(r.status).toBe(201);
      ids.push(((await r.json()) as { workout: { id: string } }).workout.id);
    }
    expect(await bonus()).toBe(100);
    expect(
      (await request(`/api/workouts/${ids[4]}`, undefined, player, "DELETE"))
        .status,
    ).toBe(200);
    expect(await bonus()).toBe(80);
    expect(
      (
        await request(
          `/api/moderation/${ids[3]}`,
          { action: "reject", reason: "Synthetic correction" },
          coach,
        )
      ).status,
    ).toBe(200);
    expect(await bonus()).toBe(50);
    expect(
      (
        await request(
          `/api/moderation/${ids[2]}`,
          { action: "void", reason: "Synthetic correction" },
          coach,
        )
      ).status,
    ).toBe(200);
    expect(await bonus()).toBe(0);
    expect(
      (
        await request(
          `/api/moderation/${ids[2]}`,
          { action: "restore", reason: "Synthetic restore" },
          coach,
        )
      ).status,
    ).toBe(200);
    expect(await bonus()).toBe(50);
    expect(
      (
        await request(
          `/api/workouts/${ids[1]}`,
          { type: "running", durationMin: 10, occurredOn: "2026-11-17" },
          player,
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(await bonus()).toBe(0);
    const adjustments = await env.DB.prepare(
      "SELECT kind,points_tenths FROM point_transactions WHERE reason_code='weekly_consistency' ORDER BY rowid",
    )
      .bind()
      .all<{ kind: string; points_tenths: number }>();
    expect(adjustments.results.map((r) => r.points_tenths)).toEqual([
      50, 30, 20, -20, -30, -50, 50, -50,
    ]);
  });
  it("counts distinct days with combined minimum minutes, not workouts or intensity", async () => {
    await log("2026-11-16", { durationMin: 10 });
    await log("2026-11-16", { durationMin: 10 });
    await log("2026-11-17");
    expect(await bonus()).toBe(0);
    await log("2026-11-18", { type: "walking", intensity: "easy" });
    expect(await bonus()).toBe(50);
    await log("2026-11-18", { type: "sprint_hiit", intensity: "max" });
    expect(await bonus()).toBe(50);
    const config = defaultRule();
    config.consistency = [{ days: 3, pointsTenths: 200 }];
    expect((await publish(config, "2026-11-22")).status).toBe(201);
    await log("2026-11-19");
    expect(await bonus()).toBe(80); // Monday's version remains pinned.
  });
  it("enforces caps and idempotency inside concurrent D1 transactions", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => log("2026-11-22", { durationMin: 60 })),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const points = await env.DB.prepare(
      "SELECT SUM(t.points_tenths) AS n FROM point_transactions t JOIN workouts w ON w.id=t.workout_id WHERE w.player_profile_id=? AND w.occurred_on='2026-11-22'",
    )
      .bind(profile)
      .first<{ n: number }>();
    expect(points!.n).toBe(1000);
    const duplicate = await Promise.all([
      log("2026-11-21", { clientRequestId: "same-request-1111" }),
      log("2026-11-21", { clientRequestId: "same-request-1111" }),
    ]);
    expect(duplicate.map((r) => r.status).sort()).toEqual([200, 201]);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM workouts WHERE client_request_id='same-request-1111'",
    )
      .bind()
      .first<{ n: number }>();
    expect(row!.n).toBe(1);
  });
  it("rejects competing edits without corrupting ledger reversals", async () => {
    const first = await log("2026-11-22");
    const id = ((await first.json()) as { workout: { id: string } }).workout.id;
    const batch = env.DB.batch.bind(env.DB);
    let arrived = 0,
      release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(env.DB, "batch").mockImplementation(async (statements) => {
      if (++arrived === 2) release();
      await ready;
      return batch(statements);
    });
    const responses = await Promise.all(
      [20, 30].map((durationMin) =>
        request(
          `/api/workouts/${id}`,
          { type: "running", durationMin, occurredOn: "2026-11-22" },
          player,
          "PATCH",
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await env.DB.prepare(
      "SELECT kind FROM point_transactions WHERE workout_id=? AND kind='reversal'",
    )
      .bind(id)
      .all();
    expect(rows.results).toHaveLength(1);
  });
  it("keeps leaderboard and dashboard totals equal to the ledger, including visible admin adjustments", async () => {
    for (const day of [16, 17, 18]) await log(`2026-11-${day}`);
    expect(
      (
        await request(
          "/api/adjustments",
          {
            profileId: profile,
            pointsTenths: 25,
            reason: "Synthetic captain adjustment",
            occurredOn: "2026-11-18",
          },
          admin,
        )
      ).status,
    ).toBe(201);
    const board = await json<{
      standings: { profile_id: string; points_tenths: number }[];
    }>("/api/leaderboard?period=week");
    expect(
      board.standings.find((r) => r.profile_id === profile)?.points_tenths,
    ).toBe(675);
    const dashboard = await json<{
      week: { pointsTenths: number };
      weeks: { pointsTenths: number }[];
      trainingBalance: { category: string; minutes: number }[];
    }>("/api/dashboard");
    expect(dashboard.week.pointsTenths).toBe(675);
    expect(dashboard.weeks.at(-1)?.pointsTenths).toBe(675);
    expect(
      dashboard.trainingBalance.find((r) => r.category === "endurance")
        ?.minutes,
    ).toBe(100);
    const history = await json<{
      history: {
        reason_code: string;
        actor_name: string;
        reason_detail: string;
      }[];
    }>("/api/scoring-history");
    expect(
      history.history.find((r) => r.reason_code === "adjustment")
        ?.reason_detail,
    ).toBe("Synthetic captain adjustment");
  });
  it("moves consistency between weeks and caps restored workouts without resurrecting zero-point awards", async () => {
    const ids: string[] = [];
    for (const day of [16, 17, 18]) {
      const r = await log(`2026-11-${day}`);
      ids.push(((await r.json()) as { workout: { id: string } }).workout.id);
    }
    expect(await bonus()).toBe(50);
    clock("2026-11-23");
    expect(
      (
        await request(
          `/api/workouts/${ids[2]}`,
          { type: "running", durationMin: 20, occurredOn: "2026-11-23" },
          player,
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(await bonus()).toBe(0);
    const first = await log("2026-11-23", { durationMin: 60 });
    const id = ((await first.json()) as { workout: { id: string } }).workout.id;
    await request(
      `/api/moderation/${id}`,
      { action: "void", reason: "Synthetic correction" },
      coach,
    );
    await log("2026-11-23", { durationMin: 60 });
    expect(
      (
        await request(
          `/api/moderation/${id}`,
          { action: "restore", reason: "Synthetic restore" },
          coach,
        )
      ).status,
    ).toBe(200);
    const total = await env.DB.prepare(
      "SELECT SUM(t.points_tenths) AS n FROM point_transactions t JOIN workouts w ON w.id=t.workout_id WHERE w.player_profile_id=? AND w.occurred_on='2026-11-23'",
    )
      .bind(profile)
      .first<{ n: number }>();
    expect(total!.n).toBe(1000);
    const zero = await log("2026-11-23");
    const zeroId = (
      (await zero.json()) as {
        workout: { id: string };
        awardedPointsTenths: number;
      }
    ).workout.id;
    await request(
      `/api/moderation/${zeroId}`,
      { action: "reject", reason: "Synthetic correction" },
      coach,
    );
    await request(
      `/api/moderation/${zeroId}`,
      { action: "restore", reason: "Synthetic restore" },
      coach,
    );
    const net = await env.DB.prepare(
      "SELECT SUM(points_tenths) AS n FROM point_transactions WHERE workout_id=?",
    )
      .bind(zeroId)
      .first<{ n: number }>();
    expect(net!.n).toBe(0);
  });

  it("selects scheduled versions by effective date, rejects stale publishers, and never rewrites saved rows", async () => {
    const later = defaultRule();
    later.types.running!.multiplierHundredths = 1500;
    expect((await publish(later, "2026-11-24")).status).toBe(201);
    const sooner = defaultRule();
    sooner.types.running!.multiplierHundredths = 1200;
    expect((await publish(sooner, "2026-11-23")).status).toBe(201);
    expect(
      (
        await request(
          "/api/scoring-settings",
          {
            config: defaultRule(),
            expectedVersion: 2,
            effectiveOn: "2026-11-23",
          },
          admin,
        )
      ).status,
    ).toBe(409);
    clock("2026-11-24");
    const created = await log("2026-11-24");
    expect(
      ((await created.json()) as { awardedPointsTenths: number })
        .awardedPointsTenths,
    ).toBe(300);
    const id = await env.DB.prepare(
      "SELECT rule_version_id FROM workouts WHERE id=?",
    )
      .bind(oldId)
      .first<{ rule_version_id: string }>();
    expect(id!.rule_version_id).toBe("rule_v1");
  });

  it("validates all settings and protects administrator permissions and immutable activity IDs", async () => {
    for (const cookie of [coach, player]) {
      expect(
        (await request("/api/scoring-settings", undefined, cookie, "GET"))
          .status,
      ).toBe(403);
      expect(
        (
          await request(
            "/api/scoring-settings",
            { config: defaultRule(), effectiveOn: "2026-11-23" },
            cookie,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            "/api/scoring-settings/preview",
            {
              config: defaultRule(),
              type: "running",
              durationMin: 10,
              intensity: "moderate",
            },
            cookie,
          )
        ).status,
      ).toBe(403);
    }
    const config = defaultRule();
    delete config.types.running;
    expect((await publish(config, "2026-11-23")).status).toBe(400);
    config.types.running = defaultRule().types.running!;
    config.sessionCapTenths = 1001;
    expect((await publish(config, "2026-11-23")).status).toBe(400);
    expect(
      (
        await request(
          "/api/rules",
          {
            dailyCapTenths: 100,
            sessionCapTenths: 200,
            weeklyLoadLimit: 600,
            effectiveOn: "2026-11-23",
          },
          admin,
        )
      ).status,
    ).toBe(400);
    const preview = await request(
      "/api/scoring-settings/preview",
      {
        config: defaultRule(),
        type: "sprint_hiit",
        durationMin: 60,
        intensity: "max",
      },
      admin,
    );
    expect(await preview.json()).toMatchObject({
      pointsTenths: 600,
      grossPointsTenths: 1008,
    });
  });
  it("adds, renames, and disables activities without rewriting identifiers or historical contributions", async () => {
    const config = defaultRule();
    config.types.cycling = {
      ...config.types.running!,
      label: "Cycling",
      categories: ["strength", "endurance"],
    };
    expect((await publish(config, "2026-11-22")).status).toBe(201);
    const created = await log("2026-11-22", {
      type: "cycling",
      durationMin: 20,
    });
    expect(created.status).toBe(201);
    const saved = await created.json() as {workout:{id:string;activity_label:string}};
    expect(saved.workout.activity_label).toBe("Cycling");
    config.types.cycling.label = "Bike training";
    config.types.cycling.enabled = false;
    expect((await publish(config, "2026-11-22")).status).toBe(201);
    expect((await log("2026-11-22", { type: "cycling" })).status).toBe(400);
    const recorded = await json<{workouts:{id:string;activity_label:string}[]}>("/api/workouts");
    expect(recorded.workouts.find(w=>w.id===saved.workout.id)?.activity_label).toBe("Cycling");
    const balance = await json<{
      trainingBalance: { category: string; minutes: number }[];
    }>("/api/dashboard");
    expect(
      balance.trainingBalance.find((r) => r.category === "strength")?.minutes,
    ).toBe(10);
    expect(
      (
        await request("/api/workouts", {
          type: "running",
          durationMin: 20,
          points: 9000,
        })
      ).status,
    ).toBe(400);
  });
});
