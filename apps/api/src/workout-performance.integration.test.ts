import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { addDays } from "@blackthorn/scoring";
import app, { type Env } from "./app";
import { loadStats, syncBadges } from "./badges";
import { openTestDatabase, testMemberSession } from "./test-db";

const today = "2026-11-08";
describe("bounded workout processing", () => {
  let env: Env, cookie: string, other: string, profile: string;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(today + "T17:00:00Z"));
    env = { DB: openTestDatabase(), EMAIL_PROVIDER: "none" };
    cookie = await testMemberSession(env.DB, "History Player");
    other = await testMemberSession(env.DB, "Other History Player");
    for (const auth of [cookie, other]) await app.request("https://club.test/api/onboarding", { method: "POST", headers: { cookie: auth, "content-type": "application/json" },
      body: JSON.stringify({ rosterName: "History Player", positionId: "pos_fullback", injuryStatus: "available" }) }, env);
    profile = ((await (await app.request("https://club.test/api/me", { headers: { cookie } }, env)).json()) as { profile: { id: string } }).profile.id;
  });
  afterEach(() => vi.useRealTimers());
  async function seed(count: number, dates?: string[]) {
    for (let i = 0; i < count; i++) {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO workouts(id,club_id,player_profile_id,type,occurred_on,duration_min,intensity,notes,status,rule_version_id,submitted_at,created_at,updated_at)
          VALUES(?,'club_blackthorn',?,'running',?,20,'moderate',?,'submitted','rule_v1',1,1,1)`)
          .bind(`history-${String(i).padStart(5, "0")}`, profile, dates?.[i] ?? today, "Long training notes. ".repeat(25)),
        env.DB.prepare(`INSERT INTO point_transactions(id,club_id,player_profile_id,workout_id,rule_version_id,kind,points_tenths,reason_code,created_at)
          VALUES(?,'club_blackthorn',?,?,'rule_v1','award',30,'formula',1)`)
          .bind(`ledger-${i}`, profile, `history-${String(i).padStart(5, "0")}`),
      ]);
    }
  }
  async function get(query = "", auth = cookie) {
    return app.request("https://club.test/api/workouts" + query, { headers: { cookie: auth } }, env);
  }
  it("pages stable ties without duplicates, preserves ledger totals, and scopes foreign cursors to the player", async () => {
    await seed(73);
    const first = await (await get()).json() as { workouts: { id: string; points_tenths: number }[]; nextCursor: string };
    expect(first.workouts).toHaveLength(20); expect(first.workouts[0]!.points_tenths).toBe(30);
    const ids = first.workouts.map(w => w.id); let cursor: string | null = first.nextCursor;
    while (cursor) {
      const page = await (await get("?context=none&limit=25&cursor=" + encodeURIComponent(cursor))).json() as typeof first;
      ids.push(...page.workouts.map(w => w.id)); cursor = page.nextCursor;
    }
    expect(ids).toHaveLength(73); expect(new Set(ids).size).toBe(73);
    expect(ids).toEqual([...ids].sort().reverse());
    const foreign = await (await get("?cursor=" + encodeURIComponent(first.nextCursor), other)).json() as { workouts: unknown[] };
    expect(foreign.workouts).toEqual([]);
    expect((await get("?context=none", "")).status).toBe(401);
  });
  it("filters rejected and voided workouts before the recent limit and rejects malformed cursors/limits", async () => {
    await seed(30);
    await env.DB.prepare("UPDATE workouts SET status='voided' WHERE id IN ('history-00029','history-00028','history-00027')").bind().run();
    const response = await (await get("?limit=3&status=counted&context=none")).json() as { workouts: { id: string }[]; estimateRule?: unknown };
    expect(response.workouts.map(w => w.id)).toEqual(["history-00026", "history-00025", "history-00024"]);
    expect(response.estimateRule).toBeUndefined();
    for (const query of ["limit=0", "limit=26", "limit=1.2", "limit=-1", "status=anything", "cursor=invalid", "cursor=[]", 'cursor=["2026-02-30",1,"id"]']) {
      expect((await get("?" + query)).status).toBe(400);
    }
  });
  it("returns exact lifetime counts and a 1,200-day streak using a single statistics row", async () => {
    await seed(1200, Array.from({ length: 1200 }, (_, i) => addDays(today, -i)));
    expect(await loadStats(env.DB, profile)).toEqual({ sessionCount: 1200, activityTypes: 1, pointsTenths: 36000, streakDays: 1200 });
    await env.DB.prepare("UPDATE workouts SET status='voided' WHERE occurred_on=?").bind(today).run();
    expect((await loadStats(env.DB, profile)).streakDays).toBe(1199);
    await env.DB.prepare("UPDATE workouts SET status='rejected' WHERE occurred_on=?").bind(addDays(today, -5)).run();
    expect((await loadStats(env.DB, profile)).streakDays).toBe(4);
    // Voiding training does not rewrite the historical ledger.
    expect((await loadStats(env.DB, profile)).pointsTenths).toBe(36000);
  });
  it("awards each badge and notification once under simultaneous submissions", async () => {
    await seed(1);
    const awards = await Promise.all([syncBadges(env, profile), syncBadges(env, profile)]);
    expect(awards.flat()).toEqual(["first_session"]);
    const notes = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='badge'").bind().first<{ n: number }>();
    expect(notes!.n).toBe(1);
  });
  it("rolls back the badge when its notification fails", async () => {
    await seed(1);
    await env.DB.prepare("CREATE TRIGGER fail_badge_notice BEFORE INSERT ON notifications WHEN NEW.kind='badge' BEGIN SELECT RAISE(ABORT,'test notification failure'); END").bind().run();
    await expect(syncBadges(env, profile)).rejects.toThrow("test notification failure");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM player_achievements WHERE player_profile_id=?").bind(profile).first<{ n: number }>();
    expect(count!.n).toBe(0);
  });
});
