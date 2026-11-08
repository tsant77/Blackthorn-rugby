import { Award, Flame, Trophy, Medal, Footprints, Layers, LockKeyhole, Check } from "lucide-react";
import { formatPoints } from "@blackthorn/scoring";
import { AccountCredentials } from "../components/AccountCredentials";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type RosterPosition } from "../api";
import { ShareLink } from "../components/ShareLink";
import { useSession } from "../session";

interface Badge { key: string; name: string; description: string; awarded_at: number | null; progress: { current: number; target: number; unit: string } }
const badgeIcons = [Award, Medal, Trophy, Flame, Flame, Layers, Footprints];
export function ProfilePage() {
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const [injuryStatus, setInjuryStatus] = useState(me?.profile?.injuryStatus ?? "available");
  const [injuryNote, setInjuryNote] = useState(me?.profile?.injuryNote ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [summary, setSummary] = useState<{ points: number; sessions: number; streak: number; rank: number | null } | null>(null);
  const [identity, setIdentity] = useState<{ position: string; group: string } | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null);

  useEffect(() => {

    if (!me?.profile) return;
    setInjuryStatus(me.profile.injuryStatus);
    setInjuryNote(me.profile.injuryNote ?? "");
    let active = true;
    setProfileError(null);
    void Promise.all([
      api<{ badges: Badge[] }>("/api/badges"),
      api<{ offseason: { pointsTenths: number; sessions: number }; streak: number }>("/api/dashboard"),
      api<{ standings: { profile_id: string; rank: number }[] }>("/api/leaderboard?period=week"),
      api<{ positions: RosterPosition[] }>("/api/roster-options"),
    ]).then(([awards, dash, board, roster]) => {
      if (!active) return;
      setBadges(awards.badges);
      setSummary({ points: dash.offseason.pointsTenths, sessions: dash.offseason.sessions, streak: dash.streak, rank: board.standings.find(row => row.profile_id === me.profile?.id)?.rank ?? null });
      const position = roster.positions.find(p => p.id === me.profile?.positionId);
      setIdentity({ position: position?.name ?? "No position", group: position?.group_name ?? "Coaches" });
    }).catch(() => { if (active) setProfileError("Could not load player statistics and achievements."); });
    return () => { active = false; };
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
      <section className="player-identity panel">
        <div className="player-monogram" aria-hidden="true">{(me?.profile?.rosterName ?? me?.user.name ?? "P").split(" ").map(n => n[0]).slice(0, 2).join("")}</div>
        <div><h2 className="font-heading text-xl font-semibold break-words">{me?.profile?.rosterName ?? me?.user.name}</h2>
          {identity ? <p className="text-sm text-quiet">{identity.position} · {identity.group}</p> : null}
          <p className="mt-half text-xs uppercase tracking-widest text-sage">{me?.membership.role}</p>
        </div>
      </section>
      {profileError ? <p role="alert" className="error-banner">{profileError}</p> : me?.profile && !summary ? <p role="status" className="text-sm text-quiet">Loading player statistics…</p> : null}
      {summary ? <section className="profile-stats" aria-label="Training statistics">
        {[["Offseason PTS", formatPoints(summary.points)], ["Workouts", summary.sessions], ["Streak · days", summary.streak], ["This week rank", summary.rank ?? "—"]].map(([label, value]) =>
          <div key={label}><p className="font-display text-2xl text-gold">{value}</p><h2 className="text-xs text-quiet">{label}</h2></div>)}
      </section> : null}
      <section className="flex flex-col gap-s2">
        <div className="flex justify-between items-center"><h2 className="font-heading font-semibold">Badges</h2><span className="text-xs text-quiet">{badges.filter(b => b.awarded_at).length} / {badges.length} earned</span></div>
        <ul className="badge-grid">
          {badges.map((badge, index) => {
            const Icon = badgeIcons[index % badgeIcons.length]!;
            const progress = badge.progress;
            return <li key={badge.key} className={`achievement ${badge.awarded_at ? "earned" : ""}`}>
              <div className="flex justify-between"><Icon size={26} aria-hidden="true" />{badge.awarded_at ? <Check size={16} aria-label="Earned" /> : <LockKeyhole size={14} aria-hidden="true" />}</div>
              <h3 className="mt-s1 font-heading text-sm font-semibold">{badge.name}</h3>
              <p className="mt-half text-xs text-quiet">{badge.awarded_at ? "Earned" : "Not yet"} · {badge.description}</p>
              {progress && !badge.awarded_at ? <div className="mt-s1">
                <progress max={progress.target} value={Math.min(progress.current, progress.target)} aria-label={`Progress toward ${badge.name}`} />
                <p className="mt-half text-xs text-quiet">{progress.current} / {progress.target} {progress.unit}</p>
              </div> : null}
            </li>;
          })}
        </ul>
      </section>
      <AccountCredentials />
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
      {me?.membership.role !== "player" ? <section className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
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
      </section> : null}
      <button type="button" onClick={() => void logout()} className="w-fit text-quiet underline">
        Sign out
      </button>
    </main>
  );
}
