import { useEffect, useState } from "react";
import { formatPoints } from "@blackthorn/scoring";
import { api, ApiError } from "../api";
import { Bars } from "../components/Bars";

interface Team {
  participation: { active: number; roster: number; rate: number };
  weeks: { start: string; pointsTenths: number }[];
  groups: { start: string; forwards: number; backs: number; coaches: number }[];
  movers: { profileId: string; rosterName: string; thisWeek: number; lastWeek: number; delta: number }[];
}

export function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Team>("/api/team").then(setTeam).catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : "Could not load the team.");
    });
  }, []);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Team</h1>
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      {team ? (
        <>
          <section className="rounded-md border border-line bg-raised p-s2">
            <h2 className="font-heading font-semibold">Participation this week</h2>
            <p className="mt-s1 font-display text-4xl text-gold">{Math.round(team.participation.rate * 100)}%</p>
            <p className="text-sm text-quiet">{team.participation.active} of {team.participation.roster} training profiles logged.</p>
          </section>
          <section className="rounded-md border border-line bg-raised p-s2">
            <Bars caption="Team points by week" rows={team.weeks.map((week) => ({ label: week.start, value: week.pointsTenths }))} />
          </section>
          <section className="rounded-md border border-line bg-raised p-s2">
            <h2 className="font-heading font-semibold">Forwards, backs, coaches</h2>
            <table className="mt-s2 w-full text-left text-sm">
              <thead>
                <tr className="text-quiet">
                  <th scope="col" className="py-half font-normal">Week</th>
                  <th scope="col" className="py-half text-right font-normal">Forwards</th>
                  <th scope="col" className="py-half text-right font-normal">Backs</th>
                  <th scope="col" className="py-half text-right font-normal">Coaches</th>
                </tr>
              </thead>
              <tbody>
                {team.groups.map((week) => (
                  <tr key={week.start} className="border-t border-line">
                    <th scope="row" className="py-half font-normal">{week.start}</th>
                    <td className="py-half text-right">{formatPoints(week.forwards)}</td>
                    <td className="py-half text-right">{formatPoints(week.backs)}</td>
                    <td className="py-half text-right">{formatPoints(week.coaches)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="rounded-md border border-line bg-raised p-s2">
            <h2 className="font-heading font-semibold">Top movers</h2>
            <ul className="mt-s2 flex flex-col gap-s1">
              {team.movers.map((row) => (
                <li key={row.profileId} className="flex justify-between">
                  <span>{row.rosterName}</span>
                  <span className="font-display text-xl">{row.delta >= 0 ? "+" : ""}{formatPoints(row.delta)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
