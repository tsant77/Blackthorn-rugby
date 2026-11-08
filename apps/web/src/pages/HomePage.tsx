import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatPoints } from "@blackthorn/scoring";
import { api } from "../api";
import { useSession } from "../session";

export function HomePage() {
  const { me } = useSession();
  const role = me?.membership.role;
  const [points, setPoints] = useState<number | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    void api<{ standings: { profile_id: string; points_tenths: number }[] }>("/api/leaderboard?period=week").then((body) => {
      const mine = body.standings.find((row) => row.profile_id === me.profile?.id);
      setPoints(mine?.points_tenths ?? 0);
    });
  }, [me]);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <div>
        <p className="text-sm text-quiet">2026-27 offseason</p>
        <h1 className="font-heading text-2xl font-semibold">
          {me?.profile?.rosterName ?? me?.user.name}
        </h1>
      </div>
      <section className="rounded-md border border-line bg-raised p-s2 shadow-card">
        <h2 className="font-heading font-semibold">This week</h2>
        <p className="mt-s1 font-display text-5xl text-gold">{points == null ? "–" : formatPoints(points)}</p>
        <p className="text-sm text-quiet">Eastern Time, Monday through Sunday. Sessions count as soon as you save them.</p>
      </section>
      {role === "admin" ? (
        <Link to="/invite" className="rounded-md bg-gold px-s2 py-s1 text-center font-heading font-semibold text-forest">
          Invite a player
        </Link>
      ) : null}
      {role === "coach" || role === "admin" ? (
        <Link to="/squad" className="rounded-md border border-line px-s2 py-s1 text-center font-heading font-semibold">
          Squad availability
        </Link>
      ) : null}
    </main>
  );
}
