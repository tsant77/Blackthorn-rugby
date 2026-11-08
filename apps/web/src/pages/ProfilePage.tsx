import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useSession } from "../session";

export function ProfilePage() {
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const [injuryStatus, setInjuryStatus] = useState(me?.profile?.injuryStatus ?? "available");
  const [injuryNote, setInjuryNote] = useState(me?.profile?.injuryNote ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setInjuryStatus(me.profile.injuryStatus);
    setInjuryNote(me.profile.injuryNote ?? "");
  }, [me]);

  async function saveInjury() {
    setError(null);
    try {
      await api("/api/me/injury", {
        method: "PATCH",
        body: JSON.stringify({ injuryStatus, injuryNote }),
      });
      await refresh();
      setMessage("Availability saved.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save.");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    await refresh();
    navigate("/login");
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">You</h1>
      <section className="rounded-md border border-line bg-raised p-s2 shadow-card">
        <p className="font-heading font-semibold">{me?.profile?.rosterName ?? me?.user.name}</p>
        <p className="text-sm text-quiet">{me?.user.email}</p>
        <p className="mt-s1 text-sm capitalize text-quiet">{me?.membership.role}</p>
      </section>
      {me?.profile ? (
        <section className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
          <h2 className="font-heading font-semibold">Availability</h2>
          <p className="text-sm text-quiet">You or a coach can change this. Out means sessions will not score.</p>
          <label className="flex flex-col gap-s1 text-sm text-quiet">
            Status
            <select
              value={injuryStatus}
              onChange={(event) => setInjuryStatus(event.target.value as "available" | "limited" | "out")}
              className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
            >
              <option value="available">Available</option>
              <option value="limited">Limited</option>
              <option value="out">Out</option>
            </select>
          </label>
          <label className="flex flex-col gap-s1 text-sm text-quiet">
            Note
            <input
              value={injuryNote}
              onChange={(event) => setInjuryNote(event.target.value)}
              className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
            />
          </label>
          {message ? <p role="status">{message}</p> : null}
          {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
          <button type="button" onClick={() => void saveInjury()} className="rounded-md bg-forest px-s2 py-s1 font-heading font-semibold text-sage">
            Save availability
          </button>
        </section>
      ) : null}
      <button type="button" onClick={() => void logout()} className="w-fit text-quiet underline">
        Sign out
      </button>
    </main>
  );
}
