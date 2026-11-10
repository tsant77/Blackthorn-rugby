import { beforeEach, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase, testMemberSession } from "./test-db";
import { addDays } from "@blackthorn/scoring";

describe("optional performance without changing points", () => {
  let env: Env, player: string, other: string, today: string;
  async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", cookie = player) {
    return app.request(`http://localhost${path}`, {method, headers:{cookie,"content-type":"application/json"}, ...(body === undefined ? {} : {body:JSON.stringify(body)})}, env);
  }
  async function json(path: string) {
    const response = await request(path); expect(response.status).toBe(200); return response.json() as Promise<any>;
  }
  const lift = (kg: number, reps=5) => ({name:"bench press",sets:3,reps,loadGrams:kg*1000});
  async function log(extra: Record<string, unknown> = {}) {
    const r = await request("/api/workouts", {type:"weight_training",durationMin:20,clientRequestId:crypto.randomUUID(),...extra});
    const body = await r.json(); expect(r.status, JSON.stringify(body)).toBe(201); return body as any;
  }
  beforeEach(async () => {
    env={DB:openTestDatabase(),EMAIL_PROVIDER:"none",APP_ORIGIN:"http://localhost"};
    player=await testMemberSession(env.DB,"metrics"); other=await testMemberSession(env.DB,"other");
    for (const cookie of [player,other]) {
      const options=await (await request("/api/roster-options",undefined,"GET",cookie)).json() as any;
      expect((await request("/api/onboarding",{rosterName:cookie===player?"Metrics Player":"Other Player",positionId:options.positions[0].id,injuryStatus:"available"},"POST",cookie)).status).toBe(200);
    }
    today=(await json("/api/workouts")).today;
    await env.DB.prepare("UPDATE competition_periods SET start_on=? WHERE kind='offseason'").bind(addDays(today,-30)).run();
  });
  it("saves metrics atomically, retries once, preserves omitted edit fields, and allows clearing", async () => {
    const id=crypto.randomUUID();
    const saved=await log({calories:200,calorieSource:"device",exercises:[lift(60)],clientRequestId:id});
    const plain=await log(); expect(saved.awardedPointsTenths).toBe(plain.awardedPointsTenths);
    const retry=await request("/api/workouts",{type:"weight_training",durationMin:20,clientRequestId:id,exercises:[lift(80)]});
    expect(retry.status).toBe(200);
    expect((await retry.json() as any).workout.exercises[0].loadGrams).toBe(60000);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM workout_exercises WHERE workout_id=?").bind(saved.workout.id).first<any>()).n).toBe(1);
    expect((await request(`/api/workouts/${saved.workout.id}`,{type:"weight_training",durationMin:20},"PATCH")).status).toBe(200);
    let row=(await json("/api/workouts")).workouts.find((w:any)=>w.id===saved.workout.id);
    expect(row.calories).toBe(200); expect(row.exercises).toEqual([lift(60)]);
    expect((await request(`/api/workouts/${saved.workout.id}`,{type:"weight_training",durationMin:20,calories:null,exercises:[]},"PATCH")).status).toBe(200);
    row=(await json("/api/workouts")).workouts.find((w:any)=>w.id===saved.workout.id);
    expect(row.calories).toBeNull(); expect(row.exercises).toEqual([]);
    expect((await request(`/api/workouts/${saved.workout.id}`,{type:"weight_training",durationMin:20,exercises:[lift(90)]},"PATCH",other)).status).toBe(404);
  });
  it("rejects malformed optional metrics without inserting workouts or points", async () => {
    for(const extra of [{calories:100},{calories:-1,calorieSource:"device"},{calories:10001,calorieSource:"estimated"},{exercises:[lift(401)]},{exercises:[{...lift(50),sets:0}]},{exercises:[{...lift(50),name:"unknown"}]},{exercises:Array(21).fill(lift(50))}]) {
      expect((await request("/api/workouts",{type:"weight_training",durationMin:20,...extra})).status).toBe(400);
    }
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM workouts").bind().first<any>()).n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM point_transactions").bind().first<any>()).n).toBe(0);
  });
  it("derives rep-specific PRs and improvement, respects privacy, voids, date periods and consistency days", async () => {
    await log({occurredOn:addDays(today,-2),exercises:[lift(50)]});
    const best=await log({exercises:[lift(60),lift(90,1)]});
    await log({exercises:[lift(55)]});
    const board=(metric:string, extra="")=>json(`/api/performance/leaderboard?period=offseason&metric=${metric}&exercise=bench%20press&reps=5${extra}`);
    expect((await board("strength")).standings).toEqual([]);
    expect((await json("/api/performance")).records.find((r:any)=>r.reps===5).load_grams).toBe(60000);
    expect((await request("/api/performance/privacy",{performancePublic:true},"PATCH")).status).toBe(200);
    expect((await board("strength")).standings[0].value).toBe(60000);
    expect((await board("improvement")).standings[0].value).toBe(20);
    expect((await board("consistency")).standings[0].value).toBe(2);
    expect((await board("strength","&groupId=unknown")).standings).toEqual([]);
    expect((await request(`/api/workouts/${best.workout.id}`,undefined,"DELETE")).status).toBe(200);
    expect((await board("strength")).standings[0].value).toBe(55000);
    expect((await json("/api/performance")).records.find((r:any)=>r.reps===5).load_grams).toBe(55000);
    await request("/api/performance/privacy",{performancePublic:false},"PATCH");
    expect((await board("consistency")).standings).toEqual([]);
    expect((await request("/api/performance/leaderboard?metric=invalid")).status).toBe(400);
    expect((await request("/api/performance",undefined,"GET","")).status).toBe(401);
  });
  it("normalizes kilometers and miles, counts only valid distances, and keeps historical scoring versions", async () => {
    const run=await log({type:"running",durationMin:30,distanceKilometers:5});
    expect(run.workout.distance_m).toBe(5000);
    const rule=await env.DB.prepare("SELECT rule_version_id FROM workouts WHERE id=?").bind(run.workout.id).first<any>();
    await request("/api/performance/privacy",{performancePublic:true},"PATCH");
    expect((await json("/api/performance/leaderboard?metric=running&period=offseason")).standings[0].value).toBe(5000);
    const row=await log({type:"rower",durationMin:30,distanceMiles:2});
    expect(row.workout.distance_m).toBe(3219);
    expect((await json("/api/performance/leaderboard?metric=rowing&period=offseason")).standings[0].value).toBe(3219);
    // A club must deliberately configure cycling; the upgrade never publishes a new rate.
    const configRow=await env.DB.prepare("SELECT config_json FROM scoring_rule_versions WHERE id='rule_v1'").bind().first<any>();
    const config=JSON.parse(configRow.config_json);
    config.types.cycling={...config.types.running,maxDistanceM:200000,minPaceSecPerKm:null};
    await env.DB.prepare("UPDATE scoring_rule_versions SET config_json=? WHERE id='rule_v1'").bind(JSON.stringify(config)).run();
    await log({type:"cycling",durationMin:30,distanceKilometers:10});
    expect((await json("/api/performance/leaderboard?metric=cycling&period=offseason")).standings[0].value).toBe(10000);
    expect((await json("/api/performance/leaderboard?metric=running&period=offseason")).standings[0].value).toBe(5000);
    expect((await json("/api/performance/leaderboard?metric=rowing&period=offseason")).standings[0].value).toBe(3219);
    expect((await request("/api/workouts",{type:"running",durationMin:30,distanceMiles:1,distanceKilometers:1})).status).toBe(400);
    expect((await env.DB.prepare("SELECT rule_version_id FROM workouts WHERE id=?").bind(run.workout.id).first<any>())?.rule_version_id).toBe(rule.rule_version_id);
  });
});
