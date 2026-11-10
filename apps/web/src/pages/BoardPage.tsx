import { ArrowUpRight, ArrowDownRight, Minus, Sparkles } from "lucide-react";
import { displayRange } from "../lib/dates";
import { useEffect, useState } from "react";
import { formatPoints } from "@blackthorn/scoring";
import { api, ApiError, type RosterPosition } from "../api";
import { useSession } from "../session";

interface Standing {
  value?: number;
  rank: number;
  previousRank: number | null;
  movement: number | null;
  profile_id: string;
  roster_name: string;
  position_name: string | null;
  group_name: string | null;
  points_tenths: number;
  workout_count: number;
}

export function BoardPage() {
  const { me } = useSession();
  const [period, setPeriod] = useState<"offseason" | "week" | "month">("week");
  const [metric, setMetric] = useState("points");
  const [exercise, setExercise] = useState("bench press");
  const [reps, setReps] = useState("5");
  const [filter, setFilter] = useState("all");
  const [positions, setPositions] = useState<RosterPosition[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ positions: RosterPosition[] }>("/api/roster-options").then((body) => setPositions(body.positions)).catch(() => setError("Could not load position filters."));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setStandings([]);
    setRange("");
    const params = new URLSearchParams({ period, metric, exercise, reps });
    if (filter === "group_forwards" || filter === "group_backs" || filter === "coaches") params.set("groupId", filter);
    else if (filter !== "all") params.set("positionId", filter);
    void api<{ start: string; end: string; standings: Standing[] }>(`${metric === "points" ? "/api/leaderboard" : "/api/performance/leaderboard"}?${params}`, { signal: controller.signal }).then((body) => {
      if (!active) return;
      setStandings(body.standings);
      setRange(displayRange(body.start, body.end));
      setError(null);
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof ApiError ? caught.message : "Could not load the board.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [period, filter, metric, exercise, reps]);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <div>
        <p className="eyebrow">RAISE THE STANDARD</p>
        <h1 className="font-heading text-2xl font-semibold">Leaderboard</h1>
        <p className="text-sm text-quiet">{range}</p>
      </div>
      <label className="flex flex-col gap-s1">Leaderboard<select aria-label="Leaderboard" value={metric} onChange={e=>setMetric(e.target.value)}>{[["points","Overall points"],["running","Running distance"],["cycling","Cycling distance"],["rowing","Rowing distance"],["strength","Strength PRs"],["improvement","Most improved"],["consistency","Consistency"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {metric === "strength" || metric === "improvement" ? <>
        <label>Exercise<select aria-label="Exercise" value={exercise} onChange={e=>setExercise(e.target.value)}>{["leg press","squat","bench press"].map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Reps per set<input type="number" min="1" max="1000" value={reps} onChange={e=>setReps(e.target.value)} /></label>
        <p className="text-sm text-quiet">{metric === "improvement" ? "Improvement from your first training day's best to a later best in this period, at this rep count." : "Heaviest recorded load at this rep count."}</p>
      </> : null}
      {metric !== "points" ? <p className="text-sm text-quiet">Only players who share performance metrics appear. Top 100; equal results share rank. Consistency counts distinct days with a qualifying session.</p> : null}
      <div className="grid grid-cols-3 gap-s1" role="group" aria-label="Period">
        {(["week", "month", "offseason"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
            className={`min-h-11 rounded-md border font-heading text-sm font-semibold capitalize ${period === value ? "border-gold bg-gold text-forest" : "border-line text-ink"}`}
          >
            {value === "week" ? "This week" : value === "month" ? "Month" : "Offseason"}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-s1 text-sm text-quiet">
        Group or position
        <select value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink">
          <option value="all">Everyone</option>
          <option value="group_forwards">Forwards</option>
          <option value="group_backs">Backs</option>
          <option value="coaches">Coaches</option>
          {positions.map((position) => (
            <option key={position.id} value={position.id}>{position.name}</option>
          ))}
        </select>
      </label>
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      {!loading && !error && standings.length === 0 ? <p className="text-quiet">No qualifying sessions in this view yet.</p> : null}
      {loading ? <p role="status" className="text-sm text-quiet">Loading standings…</p> : null}
      <ol aria-busy={loading} className="board-list flex flex-col">
        {standings.map((row) => (
          <li key={row.profile_id} className={`standing-row ${row.profile_id === me?.profile?.id ? "text-gold-soft" : ""}`}>
            <span className="w-8 font-display text-2xl text-gold">{row.rank}</span>
            <span className="flex-1">
              <span className="block font-heading font-semibold break-words">{row.roster_name}</span>
              <span className="block text-xs text-quiet break-words">{row.position_name ?? "No position"} · {row.group_name ?? "Coaches"}</span>
              <span className="mt-half flex flex-wrap items-center gap-s1 text-xs text-quiet">{metric === "points" ? `${row.workout_count} sessions` : "Self-reported performance"}
                {period === "week" && metric === "points" ? <span className="rank-movement" aria-label={movementLabel(row)} title={movementLabel(row)}>
                  {row.previousRank == null ? <Sparkles size={12} aria-hidden="true" /> : (row.movement ?? 0) > 0 ? <ArrowUpRight size={12} aria-hidden="true" /> : (row.movement ?? 0) < 0 ? <ArrowDownRight size={12} aria-hidden="true" /> : <Minus size={12} aria-hidden="true" />}
                  {row.previousRank == null ? "New" : Math.abs(row.movement ?? 0) || "—"}
                </span> : null}
              </span>
            </span>
            <span className="text-right font-display text-2xl">{metric === "points" ? formatPoints(row.points_tenths) : metric === "running" || metric === "cycling" ? ((row.value ?? 0)/1609.344).toFixed(2) : metric === "strength" ? ((row.value ?? 0)/1000).toFixed(2) : (row.value ?? 0).toFixed(metric === "improvement" ? 1 : 0)}<span className="block font-body text-xs text-quiet">{metric === "points" ? "PTS" : metric === "running" || metric === "cycling" ? "mi" : metric === "strength" ? "kg" : metric === "improvement" ? "%" : metric === "rowing" ? "m" : "days"}</span></span>
          </li>
        ))}
      </ol>
    </main>
  );
}

function movementLabel(row: Standing): string {
  if (row.previousRank == null) return "New";
  if (row.movement === 0) return "Same";
  if ((row.movement ?? 0) > 0) return `Up ${row.movement}`;
  return `Down ${Math.abs(row.movement ?? 0)}`;
}
