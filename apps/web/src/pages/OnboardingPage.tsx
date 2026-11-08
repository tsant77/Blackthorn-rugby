import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type RosterPosition } from "../api";
import { useSession } from "../session";

export function OnboardingPage() {
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const [positions, setPositions] = useState<RosterPosition[]>([]);
  const [positionId, setPositionId] = useState("");
  const [rosterName, setRosterName] = useState(me?.user.name ?? "");
  const [injuryStatus, setInjuryStatus] = useState("available");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api<{ positions: RosterPosition[] }>("/api/roster-options").then((body) => {
      setPositions(body.positions);
      setPositionId((current) => current || (me?.membership.role === "player" ? body.positions[0]?.id ?? "" : ""));
    }).catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : "Could not load positions.");
    });
  }, [me?.membership.role]);

  const staff = me?.membership.role === "coach" || me?.membership.role === "admin";
  const selected = positions.find((position) => position.id === positionId);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({ rosterName, positionId: positionId || undefined, injuryStatus }),
      });
      await refresh();
      navigate("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save your profile.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Join the roster</h1>
        <p className="mt-s1 text-quiet">
          {staff ? "Position is optional. Without one you show on the Coaches board, not forwards or backs." : "Pick the position you play. Your group follows from that."}
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2 shadow-card">
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Roster name
          <input
            required
            value={rosterName}
            onChange={(event) => setRosterName(event.target.value)}
            className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
          />
        </label>
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Position
          <select
            required={!staff}
            value={positionId}
            onChange={(event) => setPositionId(event.target.value)}
            className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
          >
            {staff ? <option value="">No position</option> : null}
            {positions.map((position) => (
              <option key={position.id} value={position.id}>{position.name}</option>
            ))}
          </select>
        </label>
        <p className="text-sm text-quiet">Group: <span className="text-ink">{selected?.group_name ?? (staff ? "Coaches" : "—")}</span></p>
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Availability
          <select
            value={injuryStatus}
            onChange={(event) => setInjuryStatus(event.target.value)}
            className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
          >
            <option value="available">Available</option>
            <option value="limited">Limited</option>
            <option value="out">Out</option>
          </select>
        </label>
        {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
        <button type="submit" disabled={pending} className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest disabled:opacity-60">
          {pending ? "Saving…" : "Save profile"}
        </button>
      </form>
    </main>
  );
}
