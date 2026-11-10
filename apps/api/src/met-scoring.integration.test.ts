import { beforeEach, describe, expect, it } from "vitest";
import app, { type Env } from "./app";
import { openTestDatabase,testMemberSession } from "./test-db";
import { ruleForDate } from "./scoring-rules";

describe("MET retrospective recalculation",()=>{
  let env:Env,admin:string,player:string,other:string,today:string;
  async function req(path:string,body?:unknown, cookie=admin,method=body===undefined?"GET":"POST") {
    return app.request("http://localhost"+path,{method,headers:{cookie,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  }
  async function json(path:string,body?:unknown,cookie=admin,method?:string):Promise<any>{const r=await req(path,body,cookie,method);const b=await r.json();expect(r.status,JSON.stringify(b)).toBeLessThan(300);return b;}
  async function log(extra:Record<string,unknown>={}) {return json("/api/workouts",{type:"weight_training",durationMin:60,clientRequestId:crypto.randomUUID(),...extra},player);}
  beforeEach(async()=>{
    env={DB:openTestDatabase(),EMAIL_PROVIDER:"none",APP_ORIGIN:"http://localhost"};
    admin=await testMemberSession(env.DB,"Admin","admin");player=await testMemberSession(env.DB,"Lifter");other=await testMemberSession(env.DB,"Observer");
    for(const cookie of [player,other])await json("/api/onboarding",{rosterName:cookie===player?"Lifter":"Observer",positionId:"pos_fullback",injuryStatus:"available"},cookie);
    today=(await json("/api/workouts",undefined,player)).today;
  });
  it("recalculates all totals atomically, retries idempotently, and pins edits/new logging to MET",async()=>{
    const first=await log();
    const preview=await json("/api/scoring-settings/met-preview",{});
    expect(preview.summary.afterTenths).toBe(350);
    const applied=await json("/api/scoring-settings/met-apply",{token:preview.token});
    const again=await json("/api/scoring-settings/met-apply",{token:preview.token});expect(again.idempotent).toBe(true);
    expect((await ruleForDate(env.DB,today)).id).toBe(applied.ruleId);
    const history=await json("/api/workouts",undefined,player);expect(history.workouts[0].points_tenths).toBe(350);
    const edited=await json(`/api/workouts/${first.workout.id}`,{type:"weight_training",durationMin:30},player,"PATCH");expect(edited.awardedPointsTenths).toBe(175);
    expect((await log()).awardedPointsTenths).toBe(350);
    const board=await json("/api/leaderboard?period=week",undefined,player);
    expect(board.standings.find((p:any)=>p.roster_name==="Lifter").points_tenths).toBe(525);
    const dash=await json("/api/dashboard",undefined,player);expect(dash.week.pointsTenths).toBe(525);
  });
  it("checks stale previews, permissions, same-day caps and simultaneous applications",async()=>{
    await log();const stale=await json("/api/scoring-settings/met-preview",{});await log();
    expect((await req("/api/scoring-settings/met-apply",{token:stale.token})).status).toBe(409);
    expect((await req("/api/scoring-settings/met-preview",{},player)).status).toBe(403);
    expect((await req("/api/scoring-settings/met-preview",{},"")).status).toBe(401);
    for(let i=0;i<4;i++)await log();
    const p=await json("/api/scoring-settings/met-preview",{});expect(p.summary.afterTenths).toBe(2000);
    const results=await Promise.all([req("/api/scoring-settings/met-apply",{token:p.token}),req("/api/scoring-settings/met-apply",{token:p.token})]);
    for(const r of results)expect(r.status).toBe(200);
    const sum=await env.DB.prepare("SELECT SUM(points_tenths) n FROM point_transactions WHERE workout_id IS NOT NULL").bind().first<any>();expect(sum.n).toBe(2000);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='met_recalculated'").bind().first<any>())?.n).toBe(1);
  });
  it("keeps closed workouts at zero and restores them at the new MET rate",async()=>{
    const saved=await log();await req(`/api/workouts/${saved.workout.id}`,undefined,player,"DELETE");
    const p=await json("/api/scoring-settings/met-preview",{});expect(p.summary.afterTenths).toBe(0);
    await json("/api/scoring-settings/met-apply",{token:p.token});
    await json(`/api/moderation/${saved.workout.id}`,{action:"restore"});
    expect((await json("/api/workouts",undefined,player)).workouts[0].points_tenths).toBe(350);
  });
  it("rolls back the complete switch if a workout changes between planning and transaction",async()=>{
    const saved=await log();const preview=await json("/api/scoring-settings/met-preview",{});
    const batch=env.DB.batch.bind(env.DB);
    let injected=false;
    env.DB.batch=async statements=>{
      if(!injected && statements.length===4){
        injected=true;
        await env.DB.prepare("UPDATE workouts SET scoring_revision=scoring_revision+1 WHERE id=?").bind(saved.workout.id).run();
      }
      return batch(statements);
    };
    expect((await req("/api/scoring-settings/met-apply",{token:preview.token})).status).toBe(409);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM scoring_rule_versions").bind().first<any>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='met_recalculated'").bind().first<any>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM point_transactions WHERE reason_code='met_recalculation'").bind().first<any>())?.n).toBe(0);
  });
  it("links public player activity with bounded pagination while excluding closed sessions and private fields",async()=>{
    const saved=await log();
    const own=await env.DB.prepare("SELECT player_profile_id FROM workouts WHERE id=?").bind(saved.workout.id).first<any>();
    // Synthetic archive rows bypass training limits solely to exercise pagination.
    for(let i=0;i<24;i++)await env.DB.prepare(`INSERT INTO workouts(id,club_id,player_profile_id,type,occurred_on,duration_min,status,submitted_at,created_at,updated_at)
      VALUES(?,'club_blackthorn',?,'running',?,20,'submitted',1,1,1)`).bind(`archive-${i}`,own.player_profile_id,today).run();
    const first=await json(`/api/activity?profileId=${own.player_profile_id}`,undefined,other);expect(first.activity).toHaveLength(20);expect(first.nextCursor).toBeTruthy();
    const second=await json(`/api/activity?profileId=${own.player_profile_id}&cursor=${encodeURIComponent(first.nextCursor)}`,undefined,other);expect(second.activity).toHaveLength(5);
    expect(new Set([...first.activity,...second.activity].map(r=>r.id)).size).toBe(25);
    expect(first.activity[0]).not.toHaveProperty("calories");expect(first.activity[0]).not.toHaveProperty("exercises");
    await req(`/api/workouts/${saved.workout.id}`,undefined,player,"DELETE");
    const after=await json(`/api/activity?profileId=${own.player_profile_id}`,undefined,other);expect(after.activity.some((r:any)=>r.id===saved.workout.id)).toBe(false);
    expect((await req("/api/activity?profileId=unknown",undefined,other)).status).toBe(404);
    expect((await req("/api/activity?cursor=invalid",undefined,other)).status).toBe(400);
  });
});
