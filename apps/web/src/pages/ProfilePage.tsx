import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { ShareLink } from "../components/ShareLink";
import { useSession } from "../session";

export function ProfilePage() {
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const [injuryStatus, setInjuryStatus] = useState(me?.profile?.injuryStatus ?? "available");
  const [injuryNote, setInjuryNote] = useState(me?.profile?.injuryNote ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [badges, setBadges] = useState<{ key: string; name: string; description: string; awarded_at: number | null }[]>([]);
  const [emailOn, setEmailOn] = useState(me?.user.emailNotifications ?? false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null);

  useEffect(() => {
    setEmailOn(me?.user.emailNotifications ?? false);
    void api<{ emailEnabled: boolean }>("/api/auth/options").then((body) => setEmailEnabled(body.emailEnabled)).catch(() => setEmailEnabled(false));
    if (!me?.profile) return;
    setInjuryStatus(me.profile.injuryStatus);
    setInjuryNote(me.profile.injuryNote ?? "");
    void api<{ badges: { key: string; name: string; description: string; awarded_at: number | null }[] }>("/api/badges").then((body) => setBadges(body.badges));
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
      <div><p className="eyebrow">THE PLAYER BEHIND THE POINTS</p><h1 className="font-heading text-2xl font-semibold">You</h1></div>
      <section className="rounded-md border border-line bg-raised p-s2 shadow-card">
        <p className="font-heading font-semibold">{me?.profile?.rosterName ?? me?.user.name}</p>
        <p className="text-sm text-quiet">{me?.user.email}</p>
        <p className="mt-s1 text-sm capitalize text-quiet">{me?.membership.role}</p>
      </section>
      <section className="rounded-md border border-line bg-raised p-s2">
        <h2 className="font-heading font-semibold">Badges</h2>
        <ul className="mt-s2 flex flex-col gap-s1">
          {badges.map((badge) => (
            <li key={badge.key}>
              <p className="font-heading font-semibold">{badge.name}</p>
              <p className="text-sm text-quiet">{badge.awarded_at ? "Earned" : "Not yet"} · {badge.description}</p>
            </li>
          ))}
        </ul>
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
      <section className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
        <h2 className="font-heading font-semibold">Another device</h2>
        <p className="text-sm text-quiet">This link works once and expires in 15 minutes. Scan the code or copy it onto the other device.</p>
        <button
          type="button"
          className="w-fit rounded-md border border-line px-s2 py-s1 font-heading font-semibold"
          onClick={() => void api<{ url: string }>("/api/signin-links", { method: "POST", body: JSON.stringify({}) }).then((body) => setDeviceUrl(body.url))}
        >
          Create a sign-in link
        </button>
        {deviceUrl ? <ShareLink url={deviceUrl} label="Device sign-in link" /> : null}
      </section>
      {emailEnabled ? (
      <label className="flex items-center gap-s2 text-sm">
        <input
          type="checkbox"
          checked={emailOn}
          onChange={(event) => {
            const next = event.target.checked;
            setEmailOn(next);
            void api("/api/me/notifications", { method: "PATCH", body: JSON.stringify({ emailNotifications: next }) }).then(() => refresh());
          }}
        />
        Email me notifications. Off by default. In-app notices stay on.
      </label>
      ) : null}
      <button type="button" onClick={() => void logout()} className="w-fit text-quiet underline">
        Sign out
      </button>
    </main>
  );
}
