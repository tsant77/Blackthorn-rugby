import { useEffect, useState } from "react";
import { api } from "../api";
import { displayDate } from "../lib/dates";

interface Progress {
  performancePublic: boolean;
  weeks: { start: string; runningM: number; cyclingM: number; rowingM: number; calories: number; sessions: number }[];
  records: { name: string; reps: number; load_grams: number; volume_grams: number }[];
}
export function MyProgress() {
  const [data, setData] = useState<Progress | null>(null);
  const [period, setPeriod] = useState("offseason");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void api<Progress>(`/api/performance?period=${period}`).then(d=>{if(active){setData(d);setError("");}}).catch(()=>{if(active)setError("Could not load progress.");});
    return ()=>{active=false;};
  }, [period]);
  async function share(checked: boolean) {
    setSaving(true); setError("");
    try {
      await api("/api/performance/privacy", {method:"PATCH",body:JSON.stringify({performancePublic:checked})});
      setData(d=>d?{...d,performancePublic:checked}:d);
    } catch { setError("Could not save sharing preference."); }
    finally { setSaving(false); }
  }
  const max = Math.max(1,...(data?.weeks.map(w=>w.runningM) ?? []));
  return <section className="panel flex flex-col gap-s2">
    <h2 className="font-heading font-semibold">My progress</h2>
    <p className="text-sm text-quiet">Optional metrics never change your points. Your progress remains visible here when sharing is off.</p>
    {error ? <p role="alert">{error}</p> : null}
    {!data ? <p>Loading progress…</p> : <>
      <label className="flex items-center gap-s1"><input type="checkbox" disabled={saving} checked={data.performancePublic} onChange={e=>void share(e.target.checked)} />Share my performance on team leaderboards</label>
      <figure><figcaption>Running distance · last 8 weeks</figcaption>
        <ul className="mt-s2 flex h-s8 items-end gap-half" aria-hidden="true">{data.weeks.map(w=><li key={w.start} className="flex-1 rounded-sm bg-pitch" style={{height:`${w.runningM/max*100}%`}} />)}</ul>
        <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Weekly performance totals</caption><thead><tr><th>Week</th><th>Run mi</th><th>Cycle mi</th><th>Row m</th><th>kcal*</th></tr></thead><tbody>
          {data.weeks.map(w=><tr key={w.start}><th scope="row">{displayDate(w.start)}</th><td>{(w.runningM/1609.344).toFixed(1)}</td><td>{(w.cyclingM/1609.344).toFixed(1)}</td><td>{w.rowingM}</td><td>{w.calories}</td></tr>)}
        </tbody></table></div>
      </figure>
      <p className="text-xs text-quiet">*Optional device-reported or estimated calories, unverified. Missing measurements are not estimates of activity.</p>
      <label>Strength records period<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="week">This week</option><option value="month">This month</option><option value="offseason">Offseason</option></select></label>
      <p className="text-sm text-quiet">Automatic PRs: your heaviest valid lift for each exercise and rep count in this period. No estimated one-rep max.</p>
      {data.records.length === 0 ? <p>No lifting records yet. Add exercises when logging a session.</p> : <ul>{data.records.map(r=><li key={`${r.name}-${r.reps}`} className="border-t border-line py-s1"><strong className="capitalize">{r.name} PR</strong> · {(r.load_grams/1000).toFixed(2)} kg × {r.reps} reps<p className="text-xs text-quiet">Total volume: {(r.volume_grams/1000).toFixed(1)} kg · sets × reps × load</p></li>)}</ul>}
    </>}
  </section>;
}
