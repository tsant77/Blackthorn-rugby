import type { Context, Hono } from "hono";
import { metRule, workoutFormulaTenths, validateRule, type Intensity } from "@blackthorn/scoring";
import { clubCatalog } from "@blackthorn/db/catalog";
import { scoringBasis } from "./workouts";
import { sha256Hex } from "./tokens";
import type { Env } from "./app";

type C = Context<{Bindings:Env}>;
interface Row { id:string; player_profile_id:string; occurred_on:string; created_at:number; type:string; duration_min:number; intensity:Intensity|null; status:string; scoring_revision:number; rule_version_id:string|null; net:number }
const club = clubCatalog.id;

export async function metPlan(db:D1Database) {
  const context=await scoringBasis(db);
  const versions=await db.prepare("SELECT id,version,effective_on FROM scoring_rule_versions WHERE club_id=? ORDER BY version DESC").bind(club).all<{id:string;version:number;effective_on:string|null}>();
  if(versions.results.some(v=>v.effective_on && v.effective_on>context.today)) throw new Error("Resolve scheduled scoring versions before applying retroactive scoring.");
  const total=await db.prepare("SELECT COUNT(*) n,MIN(occurred_on) firstDate FROM workouts WHERE club_id=?").bind(club).first<{n:number;firstDate:string|null}>();
  const rows=await db.prepare(`SELECT w.id,w.player_profile_id,w.occurred_on,w.created_at,w.type,w.duration_min,w.intensity,w.status,w.scoring_revision,w.rule_version_id,
    (SELECT COALESCE(SUM(points_tenths),0) FROM point_transactions WHERE workout_id=w.id) AS net
    FROM workouts w WHERE w.club_id=? AND (w.status IN ('submitted','approved') OR
      (SELECT COALESCE(SUM(points_tenths),0) FROM point_transactions WHERE workout_id=w.id)<>0)
    ORDER BY w.player_profile_id,w.occurred_on,w.created_at,w.id LIMIT 1001`).bind(club).all<Row>();
  if(rows.results.length>1000) throw new Error("More than 1,000 workouts: use a measured offline recalculation before switching rules.");
  const config=metRule(context.rule);
  config.version=versions.results[0]!.version+1;
  const invalid=validateRule(config); if(invalid) throw new Error(invalid);
  const totals=new Map<string,number>();
  const changes=rows.results.map(row=>{
    const key=row.player_profile_id+":"+row.occurred_on;
    const used=totals.get(key)??0;
    let target=0;
    if(row.status==="submitted" || row.status==="approved") {
      if(!config.types[row.type]) throw new Error(`No MET configuration for historical activity '${row.type}'.`);
      target=Math.min(config.sessionCapTenths,Math.max(0,config.dailyCapTenths-used),workoutFormulaTenths(config,row.type,row.duration_min,row.intensity??"moderate"));
      totals.set(key,used+target);
    }
    return {...row,target,delta:target-Number(row.net)};
  });
  const effectiveOn=[context.today,context.minDate,total!.firstDate??context.today,context.offseasonStart??context.today].sort()[0]!;
  const expectedVersion=versions.results[0]!.version;
  const token=await sha256Hex(JSON.stringify({changes,config,expectedVersion,source:context.ruleId,effectiveOn,total:total!.n}));
  const summary={workouts:total!.n,changed:changes.filter(r=>r.delta!==0).length,
    beforeTenths:changes.reduce((n,r)=>n+Number(r.net),0),afterTenths:changes.reduce((n,r)=>n+r.target,0)};
  return {token,summary,config,changes,effectiveOn,expectedVersion,sourceId:context.ruleId,sourceConfig:JSON.stringify(context.rule)};
}

export function registerMetScoring(app:Hono<{Bindings:Env}>,session:(c:C)=>Promise<{user_id:string;role:string}|null>) {
  app.post("/api/scoring-settings/met-preview",async c=>{
    const actor=await session(c);
    if(!actor) return c.json({error:"Sign in required."},401);
    if(actor.role!=="admin") return c.json({error:"Admins only."},403);
    try { const p=await metPlan(c.env.DB); return c.json({token:p.token,summary:p.summary,config:p.config,effectiveOn:p.effectiveOn}); }
    catch(e) { return c.json({error:e instanceof Error?e.message:"Could not preview MET scoring."},409); }
  });
  app.post("/api/scoring-settings/met-apply",async c=>{
    const actor=await session(c);
    if(!actor) return c.json({error:"Sign in required."},401);
    if(actor.role!=="admin") return c.json({error:"Admins only."},403);
    const body=await c.req.json().catch(()=>null);
    if(typeof body?.token!=="string" || !/^[a-f0-9]{64}$/.test(body.token)) return c.json({error:"Preview the recalculation first."},400);
    const runId="met-recalc:"+body.token;
    const existing=await c.env.DB.prepare("SELECT after_json FROM audit_events WHERE id=? AND club_id=?").bind(runId,club).first<{after_json:string}>();
    if(existing) return c.json({ok:true,idempotent:true,...JSON.parse(existing.after_json)});
    let p:Awaited<ReturnType<typeof metPlan>>;
    try { p=await metPlan(c.env.DB); } catch(e) { return c.json({error:String(e)},409); }
    if(p.token!==body.token) {
      const completed=await c.env.DB.prepare("SELECT after_json FROM audit_events WHERE id=?").bind(runId).first<{after_json:string}>();
      if(completed) return c.json({ok:true,idempotent:true,...JSON.parse(completed.after_json)});
      return c.json({error:"Workouts or rules changed. Refresh the preview."},409);
    }
    const now=Date.now(), id=crypto.randomUUID(), data=JSON.stringify(p.changes);
    // The audit NOT NULL guard aborts the whole batch on a concurrent mutation,
    // new workout, changed ledger or scoring publication. No partially changed totals.
    const result={summary:p.summary,ruleId:id,version:p.config.version};
    try { await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO audit_events(id,club_id,actor_user_id,action,entity_type,entity_id,after_json,created_at)
        SELECT ?,?,?,CASE WHEN
          (SELECT MAX(version) FROM scoring_rule_versions WHERE club_id=?)=? AND
          (SELECT COUNT(*) FROM workouts WHERE club_id=?)=? AND
          (SELECT COUNT(*) FROM workouts w WHERE w.club_id=? AND (w.status IN ('submitted','approved') OR (SELECT COALESCE(SUM(points_tenths),0) FROM point_transactions WHERE workout_id=w.id)<>0))=? AND
          NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN workouts w ON w.id=json_extract(j.value,'$.id')
            WHERE w.id IS NULL OR w.club_id<>? OR w.scoring_revision<>json_extract(j.value,'$.scoring_revision')
            OR w.status<>json_extract(j.value,'$.status') OR COALESCE(w.rule_version_id,'')<>COALESCE(json_extract(j.value,'$.rule_version_id'),'')
            OR (SELECT COALESCE(SUM(points_tenths),0) FROM point_transactions WHERE workout_id=w.id)<>json_extract(j.value,'$.net'))
          THEN 'met_recalculated' ELSE NULL END,'scoring_rule_version',?,?,?`)
        .bind(runId,club,actor.user_id,club,p.expectedVersion,club,p.summary.workouts,club,p.changes.length,data,club,id,JSON.stringify(result),now),
      c.env.DB.prepare(`INSERT INTO scoring_rule_versions(id,club_id,version,status,daily_cap_tenths,session_cap_tenths,weekly_load_limit,backdate_days,config_json,notes,effective_on,created_by,created_at)
        VALUES(?,?,?,'draft',?,?,?,?,?,'MET-based scoring; historical workouts recalculated',?,?,?)`)
        .bind(id,club,p.config.version,p.config.dailyCapTenths,p.config.sessionCapTenths,p.config.weeklyLoadLimit,p.config.backdateDays,JSON.stringify(p.config),p.effectiveOn,actor.user_id,now),
      c.env.DB.prepare(`INSERT INTO point_transactions(id,club_id,player_profile_id,workout_id,rule_version_id,kind,points_tenths,reason_code,reason_detail,occurred_on,created_by,created_at)
        SELECT ?||':'||json_extract(value,'$.id'),?,json_extract(value,'$.player_profile_id'),json_extract(value,'$.id'),?,'adjustment',json_extract(value,'$.delta'),
          'met_recalculation','MET-based retrospective recalculation',json_extract(value,'$.occurred_on'),?,? FROM json_each(?) WHERE json_extract(value,'$.delta')<>0`)
        .bind(runId,club,id,actor.user_id,now,data),
      c.env.DB.prepare("UPDATE workouts SET rule_version_id=?,scoring_revision=scoring_revision+1,updated_at=? WHERE club_id=?").bind(id,now,club),
    ]); } catch {
      const completed=await c.env.DB.prepare("SELECT after_json FROM audit_events WHERE id=?").bind(runId).first<{after_json:string}>();
      if(completed) return c.json({ok:true,idempotent:true,...JSON.parse(completed.after_json)});
      return c.json({error:"Recalculation conflicted or failed; nothing was applied. Preview again."},409);
    }
    return c.json({ok:true,idempotent:false,...result});
  });
}
