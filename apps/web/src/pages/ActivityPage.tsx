import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatPoints } from "@blackthorn/scoring";
import { api, ApiError } from "../api";
import { displayDate } from "../lib/dates";

interface Item { id:string; type:string; occurred_on:string; duration_min:number; roster_name:string; points_tenths:number }
interface Page { activity:Item[]; player:{roster_name:string}|null; nextCursor:string|null }
export function ActivityPage() {
  const [params]=useSearchParams(),profileId=params.get("profileId");
  const generation=useRef(0);
  const [items,setItems]=useState<Item[]>([]),[name,setName]=useState("");
  const [cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  function url(next?:string) {
    const query=new URLSearchParams();
    if(profileId) query.set("profileId",profileId);
    if(next) query.set("cursor",next);
    return `/api/activity?${query}`;
  }
  useEffect(()=>{
    const current=++generation.current;
    setItems([]);setName("");setCursor(null);setLoading(true);setError("");
    void api<Page>(url()).then(body=>{if(generation.current===current){setItems(body.activity);setName(body.player?.roster_name??"");setCursor(body.nextCursor);}})
      .catch(e=>{if(generation.current===current)setError(e instanceof ApiError?e.message:"Could not load activity.");})
      .finally(()=>{if(generation.current===current)setLoading(false);});
    return ()=>{generation.current++;};
  },[profileId]);
  async function more() {
    if(!cursor || loading) return;
    const current=generation.current;
    setLoading(true);setError("");
    try {
      const body=await api<Page>(url(cursor));
      if(current===generation.current){setItems(old=>[...old,...body.activity.filter(row=>!old.some(r=>r.id===row.id))]);setCursor(body.nextCursor);}
    } catch(e){if(current===generation.current)setError(e instanceof ApiError?e.message:"Could not load older activity.");}
    finally {if(current===generation.current)setLoading(false);}
  }
  return <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
    <h1 className="font-heading text-2xl font-semibold">{profileId?`${name || "Player"} activity log`:"Team activity"}</h1>
    {profileId?<Link className="text-sage underline" to="/board">Back to leaderboard</Link>:null}
    {error?<p role="alert">{error}</p>:null}
    {!loading && !error && !items.length?<p className="text-quiet">No logged sessions yet.</p>:null}
    <ul className="flex flex-col gap-s1">{items.map(item=><li key={item.id} className="rounded-md border border-line bg-raised px-s2 py-s1">
      <p className="font-heading font-semibold">{item.roster_name}</p>
      <p className="text-sm text-quiet">{item.type.replaceAll("_"," ")} · {displayDate(item.occurred_on)} · {item.duration_min} min · {formatPoints(item.points_tenths)} PTS</p>
    </li>)}</ul>
    {loading?<p role="status">Loading activity…</p>:null}
    {cursor?<button className="secondary-button" disabled={loading} onClick={()=>void more()}>Load older activities</button>:null}
  </main>;
}
