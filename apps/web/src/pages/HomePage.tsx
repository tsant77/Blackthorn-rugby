import { TrainingBalance, type Balance } from "../components/TrainingBalance";
import { displayDate } from "../lib/dates";
import { Flame, Plus, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatPoints } from "@blackthorn/scoring";
import { api, ApiError } from "../api";
import { Bars } from "../components/Bars";
import { useSession } from "../session";

interface Dashboard {
  trainingBalance?: Balance;
  streak: number;
  week: { pointsTenths: number; sessions: number };
  month: { pointsTenths: number; sessions: number };
  offseason: { pointsTenths: number; sessions: number };
  byType: { type: string; label?: string; points_tenths: number; sessions: number }[];
  weeks: { start: string; pointsTenths: number }[];
}

interface RecentWorkout {
  id: string;
  type: string;
  activity_label?: string;
  occurred_on: string;
  duration_min: number;
  points_tenths: number;
  status: string;
}

type RecentActivity =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; workouts: RecentWorkout[] };

export function HomePage() {
  const { me } = useSession();
  const role = me?.membership.role;
  const staff = role === "admin" || role === "coach";
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentActivity>({ status: "loading" });
  const [dash, setDash] = useState<Dashboard | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    void api<Dashboard>("/api/dashboard").then(setDash).catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load your training data."));
    let active = true;
    setRecent({ status: "loading" });
    void api<{ workouts: RecentWorkout[] }>("/api/workouts").then((body) => {
      if (active) setRecent({
        status: "ready",
        workouts: body.workouts.filter((workout) => workout.status !== "voided" && workout.status !== "rejected").slice(0, 3),
      });
    }).catch(() => {
      if (active) setRecent({ status: "error" });
    });
    return () => { active = false; };
  }, [me]);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <div>
        <p className="eyebrow">YOUR OFFSEASON STARTS HERE</p>
        <h1 className="font-heading text-2xl font-semibold">{me?.profile?.rosterName ?? me?.user.name}</h1>
      </div>
      {!me?.profile && staff ? (
        <Link to="/onboarding" className="rounded-md bg-gold px-s2 py-s1 text-center font-heading font-semibold text-forest">
          Set up a training profile
        </Link>
      ) : null}
      <Link to="/log" className="quick-log"><Plus size={20} aria-hidden="true" /> Log a workout <ArrowUpRight size={18} aria-hidden="true" /></Link>
      {error ? <p role="alert" className="error-banner">{error}</p> : null}
      {me?.profile && !dash && !error ? <p role="status" className="text-quiet">Loading your training data…</p> : null}
      {dash ? (
        <>
          <section className="performance-hero" aria-label="Weekly performance">
            <p className="eyebrow">THIS WEEK · POINTS</p>
            <p className="hero-points mt-s2">{formatPoints(dash.week.pointsTenths)}</p>
            <p className="mt-s2 text-sm text-sage">{dash.week.sessions} sessions logged · Every session counts.</p>
          </section>
          <section className="grid grid-cols-2 gap-s1">
            <Stat label="Month" value={formatPoints(dash.month.pointsTenths)} detail={`${dash.month.sessions} sessions`} />
            <Stat label="Season" value={formatPoints(dash.offseason.pointsTenths)} detail={`${dash.offseason.sessions} sessions`} />
          </section>
          <p className="streak-card text-quiet"><Flame className="text-gold" aria-hidden="true" /> Streak: <span className="font-display text-2xl text-gold">{dash.streak}</span> {dash.streak === 1 ? "day" : "days"}</p>
          <section className="rounded-md border border-line bg-raised p-s2">
            <Bars caption="Training progress · weekly points" rows={dash.weeks.map((week) => ({ label: week.start, value: week.pointsTenths }))} />
          </section>
          <section className="rounded-md border border-line bg-raised p-s2">
            <h2 className="font-heading font-semibold">By activity</h2>
            {dash.byType.length === 0 ? <p className="mt-s1 text-quiet">No points yet.</p> : (
              <ul className="mt-s2 flex flex-col gap-s1">
                {dash.byType.map((row) => (
                  <li key={row.type} className="flex justify-between capitalize">
                    <span>{row.label ?? row.type.replaceAll("_", " ")}</span>
                    <span className="font-display text-xl">{formatPoints(row.points_tenths)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
      {me?.profile ? <section className="flex flex-col gap-s2">
        <div className="flex items-center justify-between"><h2 className="font-heading font-semibold">Recent activity</h2><Link to="/log" className="text-sm text-sage">View all</Link></div>
        {recent.status === "loading" ? <p role="status" className="text-sm text-quiet">Loading recent activity…</p>
          : recent.status === "error" ? <p role="alert" className="error-banner">Could not load recent activity.</p>
          : recent.workouts.length ? recent.workouts.map((workout) => <article key={workout.id} className="session-card"><div><h3 className="font-heading font-semibold capitalize">{workout.activity_label ?? workout.type.replaceAll("_", " ")}</h3><p className="text-sm text-quiet">{displayDate(workout.occurred_on)} · {workout.duration_min} min</p></div><span className="font-display text-2xl text-gold">{formatPoints(workout.points_tenths)} <span className="font-body text-xs">PTS</span></span></article>) : <p className="text-sm text-quiet">Your first session starts the story. Log a workout to get going.</p>}
      </section> : null}
      <Link to="/team" className="rounded-md border border-line px-s2 py-s1 text-center font-heading font-semibold">Team dashboard</Link>
      {role === "admin" ? (
        <Link to="/invite" className="rounded-md bg-gold px-s2 py-s1 text-center font-heading font-semibold text-forest">Invite a player</Link>
      ) : null}
      {staff ? (
        <Link to="/squad" className="rounded-md border border-line px-s2 py-s1 text-center font-heading font-semibold">Squad availability</Link>
      ) : null}
      {dash?.trainingBalance ? <TrainingBalance balance={dash.trainingBalance} /> : null}
    </main>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="rounded-md border border-line bg-raised p-s1">
      <h2 className="text-sm text-quiet">{label}</h2>
      <p className="font-display text-2xl text-gold">{value}</p>
      <p className="text-sm text-quiet">{detail}</p>
    </section>
  );
}
