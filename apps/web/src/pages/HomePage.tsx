import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatPoints } from "@blackthorn/scoring";
import { api } from "../api";
import { Bars } from "../components/Bars";
import { useSession } from "../session";

interface Dashboard {
  streak: number;
  week: { pointsTenths: number; sessions: number };
  month: { pointsTenths: number; sessions: number };
  offseason: { pointsTenths: number; sessions: number };
  byType: { type: string; points_tenths: number; sessions: number }[];
  weeks: { start: string; pointsTenths: number }[];
}

export function HomePage() {
  const { me } = useSession();
  const role = me?.membership.role;
  const staff = role === "admin" || role === "coach";
  const [dash, setDash] = useState<Dashboard | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    void api<Dashboard>("/api/dashboard").then(setDash);
  }, [me]);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <div>
        <p className="text-sm text-quiet">2026-27 offseason</p>
        <h1 className="font-heading text-2xl font-semibold">{me?.profile?.rosterName ?? me?.user.name}</h1>
      </div>
      {!me?.profile && staff ? (
        <Link to="/onboarding" className="rounded-md bg-gold px-s2 py-s1 text-center font-heading font-semibold text-forest">
          Set up a training profile
        </Link>
      ) : null}
      {dash ? (
        <>
          <section className="grid grid-cols-3 gap-s1">
            <Stat label="Week" value={formatPoints(dash.week.pointsTenths)} detail={`${dash.week.sessions} sessions`} />
            <Stat label="Month" value={formatPoints(dash.month.pointsTenths)} detail={`${dash.month.sessions} sessions`} />
            <Stat label="Season" value={formatPoints(dash.offseason.pointsTenths)} detail={`${dash.offseason.sessions} sessions`} />
          </section>
          <p className="text-quiet">Streak: <span className="font-display text-2xl text-gold">{dash.streak}</span> {dash.streak === 1 ? "day" : "days"}</p>
          <section className="rounded-md border border-line bg-raised p-s2">
            <Bars caption="Weekly points" rows={dash.weeks.map((week) => ({ label: week.start, value: week.pointsTenths }))} />
          </section>
          <section className="rounded-md border border-line bg-raised p-s2">
            <h2 className="font-heading font-semibold">By activity</h2>
            {dash.byType.length === 0 ? <p className="mt-s1 text-quiet">No points yet.</p> : (
              <ul className="mt-s2 flex flex-col gap-s1">
                {dash.byType.map((row) => (
                  <li key={row.type} className="flex justify-between capitalize">
                    <span>{row.type.replaceAll("_", " ")}</span>
                    <span className="font-display text-xl">{formatPoints(row.points_tenths)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
      <Link to="/team" className="rounded-md border border-line px-s2 py-s1 text-center font-heading font-semibold">Team dashboard</Link>
      {role === "admin" ? (
        <Link to="/invite" className="rounded-md bg-gold px-s2 py-s1 text-center font-heading font-semibold text-forest">Invite a player</Link>
      ) : null}
      {staff ? (
        <Link to="/squad" className="rounded-md border border-line px-s2 py-s1 text-center font-heading font-semibold">Squad availability</Link>
      ) : null}
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
