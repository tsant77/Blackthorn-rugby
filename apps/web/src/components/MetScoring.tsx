import { useState } from "react";
import { api, ApiError } from "../api";
import { formatPoints, type ScoringRule } from "@blackthorn/scoring";

interface Preview { token:string; summary:{workouts:number;changed:number;beforeTenths:number;afterTenths:number}; config:ScoringRule; effectiveOn:string }
export function MetScoring({onApplied}:{onApplied:()=>void}) {
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  async function run(apply:boolean) {
    setBusy(true);setError("");setMessage("");
    try {
      if(apply && preview) {
        await api("/api/scoring-settings/met-apply",{method:"POST",body:JSON.stringify({token:preview.token})});
        setPreview(null);setMessage("MET scoring applied. Existing workout totals and leaderboards have been recalculated.");onApplied();
      } else setPreview(await api<Preview>("/api/scoring-settings/met-preview",{method:"POST",body:"{}"}));
    } catch(e) {setError(e instanceof ApiError?e.message:"Could not recalculate scoring.");setPreview(null);}
    finally {setBusy(false);}
  }
  return <section className="panel flex flex-col gap-s2"><h2 className="font-heading font-semibold">MET-based scoring</h2>
    <p>Switch all existing workouts and future logging to MET-based points. Current point totals will change.</p>
    <p className="text-sm text-quiet">Points = reference MET × minutes ÷ 6 × intensity adjustment. Moderate weights: 35 points per hour. Session cap: 120; daily cap: 200. Weekly bonuses and manual adjustments stay in place. Distance and body weight do not add points.</p>
    <a className="text-sage underline" href="https://pacompendium.com/" target="_blank" rel="noreferrer">2024 Adult Compendium references</a>
    <button className="secondary-button" disabled={busy} onClick={()=>void run(false)}>Preview MET recalculation</button>
    {preview ? <><p>{preview.summary.changed} of {preview.summary.workouts} workouts change. Workout points: {formatPoints(preview.summary.beforeTenths)} → {formatPoints(preview.summary.afterTenths)}.</p>
      <table className="text-sm"><caption>Moderate intensity reference rates</caption><thead><tr><th>Activity</th><th>MET</th><th>Points / hour</th></tr></thead><tbody>{Object.entries(preview.config.types).filter(([,r])=>r.enabled!==false).map(([id,r])=><tr key={id}><th scope="row">{r.label??id.replaceAll("_"," ")}</th><td>{(r.metHundredths??0)/100}</td><td>{(r.metHundredths??0)/10}</td></tr>)}</tbody></table>
      <button className="save-workout" disabled={busy} onClick={()=>void run(true)}>Apply MET scoring to all workouts</button></> : null}
    {busy ? <p role="status">Calculating…</p> : null}{error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </section>;
}
