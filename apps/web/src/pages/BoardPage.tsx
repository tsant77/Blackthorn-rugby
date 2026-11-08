import { ArrowUpRight, ArrowDownRight, Minus, Sparkles } from "lucide-react";
import { displayRange } from "../lib/dates";
import { useEffect, useState } from "react";
import { formatPoints } from "@blackthorn/scoring";
import { api, ApiError, type RosterPosition } from "../api";
import { useSession } from "../session";

interface Standing {
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
  const [filter, setFilter] = useState("all");
  const [positions, setPositions] = useState<RosterPosition[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [range, setRange] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ positions: RosterPosition[] }>("/api/roster-options").then((body) => setPositions(body.positions));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ period });
    if (filter === "group_forwards" || filter === "group_backs" || filter === "coaches") params.set("groupId", filter);
    else if (filter !== "all") params.set("positionId", filter);
    void api<{ start: string; end: string; standings: Standing[] }>(`/api/leaderboard?${params}`).then((body) => {
      setStandings(body.standings);
      setRange(displayRange(body.start, body.end));
      setError(null);
    }).catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : "Could not load the board.");
    });
  }, [period, filter]);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <div>
        <p className="eyebrow">RAISE THE STANDARD</p>
        <h1 className="font-heading text-2xl font-semibold">Leaderboard</h1>
        <p className="text-sm text-quiet">{range}</p>
      </div>
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
      {standings.length === 0 ? <p className="text-quiet">No scored sessions in this view yet.</p> : null}
      <ol className="board-list flex flex-col">
        {standings.map((row) => (
          <li key={row.profile_id} className={`standing-row ${row.profile_id === me?.profile?.id ? "text-gold-soft" : ""}`}>
            <span className="w-8 font-display text-2xl text-gold">{row.rank}</span>
            <span className="flex-1">
              <span className="block font-heading font-semibold break-words">{row.roster_name}</span>
              <span className="block text-xs text-quiet break-words">{row.position_name ?? "No position"} · {row.group_name ?? "Coaches"}</span>
              <span className="mt-half flex flex-wrap items-center gap-s1 text-xs text-quiet">{row.workout_count} sessions
                {period === "week" ? <span className="rank-movement" aria-label={movementLabel(row)} title={movementLabel(row)}>
                  {row.previousRank == null ? <Sparkles size={12} aria-hidden="true" /> : (row.movement ?? 0) > 0 ? <ArrowUpRight size={12} aria-hidden="true" /> : (row.movement ?? 0) < 0 ? <ArrowDownRight size={12} aria-hidden="true" /> : <Minus size={12} aria-hidden="true" />}
                  {row.previousRank == null ? "New" : Math.abs(row.movement ?? 0) || "—"}
                </span> : null}
              </span>
            </span>
            <span className="text-right font-display text-2xl">{formatPoints(row.points_tenths)}<span className="block font-body text-xs text-quiet">PTS</span></span>
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
