import { Link } from "react-router-dom";
import { useSession } from "../session";

export function HomePage() {
  const { me } = useSession();
  const role = me?.membership.role;
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
        <p className="mt-s1 font-display text-5xl text-gold">0.0</p>
        <p className="text-sm text-quiet">Points show up here once workout logging opens.</p>
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
