import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { clubCatalog } from "@blackthorn/db/catalog";
import type { Env } from "./app";

type C = Context<{ Bindings: Env }>;
type Actor = { user_id: string; role: string };
const categories = ["feature","improvement","bug"];
const statuses = ["new","planned","in_progress","completed","declined"];
const announcement = "team-suggestions-v1";

export function registerSuggestionRoutes(app: Hono<{ Bindings: Env }>, session: (c:C)=>Promise<Actor|null>) {
  app.use("/api/suggestions/*", bodyLimit({maxSize: 8192,onError:c=>c.json({error:"Request too large."},413)}));
  app.use("/api/suggestions", bodyLimit({maxSize: 8192,onError:c=>c.json({error:"Request too large."},413)}));
  app.get("/api/suggestions", async c=>{
    const actor=await session(c);
    if(!actor) return c.json({error:"Sign in required."},401);
    const rows=await c.env.DB.prepare(`SELECT s.id,s.category,s.title,s.description,s.status,s.created_at,s.updated_at,
      (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id=s.id) AS votes,
      EXISTS(SELECT 1 FROM suggestion_votes v WHERE v.suggestion_id=s.id AND v.user_id=?) AS voted,
      CASE WHEN s.author_user_id=? THEN 1 ELSE 0 END AS mine,
      CASE WHEN ?='admin' THEN s.author_user_id ELSE NULL END AS author_user_id
      FROM team_suggestions s WHERE s.club_id=? ORDER BY s.created_at DESC LIMIT 150`)
      .bind(actor.user_id,actor.user_id,actor.role,clubCatalog.id).all();
    return c.json({suggestions:rows.results,admin:actor.role==="admin"});
  });
  app.post("/api/suggestions", async c=>{
    const actor=await session(c);
    if(!actor) return c.json({error:"Sign in required."},401);
    const body=await parse(c);
    const title=typeof body?.title==="string"?body.title.trim():"";
    const description=typeof body?.description==="string"?body.description.trim():"";
    if(!categories.includes(String(body?.category))||title.length<3||title.length>100||description.length>2000)
      return c.json({error:"Choose a category and enter a title (3–100 characters) and details (up to 2000)."},400);
    const id=crypto.randomUUID(),now=Date.now();
    await c.env.DB.prepare("INSERT INTO team_suggestions(id,club_id,author_user_id,category,title,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'new',?,?)")
      .bind(id,clubCatalog.id,actor.user_id,body!.category,title,description,now,now).run();
    return c.json({ok:true,id},201);
  });
  app.patch("/api/suggestions/:id",async c=>{
    const actor=await session(c);
    if(!actor) return c.json({error:"Sign in required."},401);
    const row=await c.env.DB.prepare("SELECT author_user_id,status,title,description FROM team_suggestions WHERE id=? AND club_id=?")
      .bind(c.req.param("id"),clubCatalog.id).first<{author_user_id:string;status:string;title:string;description:string}>();
    if(!row) return c.json({error:"Suggestion not found."},404);
    const body=await parse(c);
    if(!body) return c.json({error:"Invalid request."},400);
    if(actor.role==="admin" && body.status!==undefined){
      if(!statuses.includes(String(body.status))) return c.json({error:"Invalid status."},400);
      await c.env.DB.prepare("UPDATE team_suggestions SET status=?,updated_at=? WHERE id=? AND club_id=?")
        .bind(body.status,Date.now(),c.req.param("id"),clubCatalog.id).run();
      return c.json({ok:true});
    }
    if(row.author_user_id!==actor.user_id) return c.json({error:"Only the author can edit this suggestion."},403);
    if(row.status!=="new") return c.json({error:"Only new suggestions can be edited."},409);
    const title=typeof body.title==="string"?body.title.trim():"";
    const description=typeof body.description==="string"?body.description.trim():"";
    if(title.length<3||title.length>100||description.length>2000) return c.json({error:"Invalid title or details."},400);
    await c.env.DB.prepare("UPDATE team_suggestions SET title=?,description=?,updated_at=? WHERE id=? AND club_id=?")
      .bind(title,description,Date.now(),c.req.param("id"),clubCatalog.id).run();
    return c.json({ok:true});
  });
  app.post("/api/suggestions/:id/vote",async c=>{
    const actor=await session(c);
    if(!actor) return c.json({error:"Sign in required."},401);
    const id=c.req.param("id");
    const exists=await c.env.DB.prepare("SELECT 1 FROM team_suggestions WHERE id=? AND club_id=?").bind(id,clubCatalog.id).first();
    if(!exists) return c.json({error:"Suggestion not found."},404);
    const prior=await c.env.DB.prepare("SELECT 1 FROM suggestion_votes WHERE suggestion_id=? AND user_id=?").bind(id,actor.user_id).first();
    if(prior) await c.env.DB.prepare("DELETE FROM suggestion_votes WHERE suggestion_id=? AND user_id=?").bind(id,actor.user_id).run();
    else await c.env.DB.prepare("INSERT OR IGNORE INTO suggestion_votes(suggestion_id,user_id,created_at) VALUES(?,?,?)").bind(id,actor.user_id,Date.now()).run();
    return c.json({ok:true,voted:!prior});
  });
  app.get("/api/suggestions/announcement",async c=>{
    const actor=await session(c);
    if(!actor) return c.json({error:"Sign in required."},401);
    const row=await c.env.DB.prepare("SELECT 1 FROM suggestion_announcements WHERE user_id=? AND announcement_key=?")
      .bind(actor.user_id,announcement).first();
    return c.json({show:!row});
  });
  app.post("/api/suggestions/announcement/dismiss",async c=>{
    const actor=await session(c);
    if(!actor) return c.json({error:"Sign in required."},401);
    await c.env.DB.prepare("INSERT OR IGNORE INTO suggestion_announcements(user_id,announcement_key,seen_at) VALUES(?,?,?)")
      .bind(actor.user_id,announcement,Date.now()).run();
    return c.json({ok:true});
  });
}
async function parse(c:C):Promise<Record<string,unknown>|null>{
  try { const b=await c.req.json();return b&&typeof b==="object"&&!Array.isArray(b)?b:null; } catch {return null;}
}
