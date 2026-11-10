import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useSession } from "../session";

interface SquadPlayer {
  id: string;
  roster_name: string;
  injury_status: "available" | "limited" | "out";
  injury_note: string | null;
  position_name: string | null;
  group_name: string | null;
}

export function SquadPage() {
  const { me } = useSession();
  const [players, setPlayers] = useState<SquadPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me?.membership.role === "player") return;
    void api<{ players: SquadPlayer[] }>("/api/squad").then((body) => setPlayers(body.players)).catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : "Could not load the squad.");
    });
  }, [me?.membership.role]);

  if (me?.membership.role === "player") {
    return <main className="px-s2 py-s4 text-quiet">Squad availability is for coaches.</main>;
  }

  async function setInjury(player: SquadPlayer, injuryStatus: SquadPlayer["injury_status"]) {
    await api(`/api/squad/${player.id}/injury`, {
      method: "PATCH",
      body: JSON.stringify({ injuryStatus, injuryNote: player.injury_note }),
    });
    setPlayers((current) => current.map((row) => row.id === player.id ? { ...row, injury_status: injuryStatus } : row));
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Squad</h1>
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      {players.length === 0 ? (
        <p className="rounded-md border border-line bg-raised p-s2 text-quiet">No players have finished onboarding yet.</p>
      ) : (
        <ul className="flex flex-col gap-s2">
          {players.map((player) => (
            <li key={player.id} className="rounded-md border border-line bg-raised p-s2">
              <p className="font-heading font-semibold">{player.roster_name}</p>
              <p className="text-sm text-quiet">{player.position_name} · {player.group_name}</p>
              <label className="mt-s1 flex flex-col gap-s1 text-sm text-quiet">
                Availability
                <select
                  value={player.injury_status}
                  onChange={(event) => void setInjury(player, event.target.value as SquadPlayer["injury_status"])}
                  className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
                >
                  <option value="available">Available</option>
                  <option value="limited">Limited</option>
                  <option value="out">Out</option>
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
