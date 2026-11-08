import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { ShareLink } from "../components/ShareLink";
import { useSession } from "../session";
import { displayDate } from "../lib/dates";

interface Status {
  link: { enabled: number; expires_at: number | null } | null;
  players: { id: string; name: string; username: string; status: string; created_at: number }[];
}
export function RegistrationAdminPage() {
  const { me } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = me?.membership.role === "admin";
  async function load() { setStatus(await api<Status>("/api/registration")); }
  useEffect(() => { if (admin) void load().catch(() => setError("Could not load registration status.")); }, [admin]);
  async function update(body: { action: string } | { enabled: boolean }) {
    setPending(true); setError(null);
    try {
      const response = await api<{ url?: string }>("/api/registration", { method: "POST", body: JSON.stringify(body) });
      if (response.url) setUrl(response.url);
      await load();
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not update registration."); }
    finally { setPending(false); }
  }
  if (!admin) return <main className="px-s2 py-s4"><h1>Team registration</h1><p>Only administrators can manage registration.</p></main>;
  return <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
    <div><p className="eyebrow">BUILD THE SQUAD</p><h1 className="font-heading text-2xl font-semibold">Team registration</h1></div>
    {error ? <p role="alert" className="error-banner">{error}</p> : null}
    {!status ? <p role="status">Loading registration…</p> : <section className="panel">
      <h2 className="font-heading font-semibold">{!status.link ? "No registration link yet" : status.link.enabled && (!status.link.expires_at || status.link.expires_at > Date.now()) ? "Registrations open" : "Registrations closed"}</h2>
      <p className="text-sm text-quiet">One permanent link for WhatsApp. Anyone with it can create a Player account. No approval is needed.</p>
      <button type="button" className="save-workout" disabled={pending} onClick={() => {
        if (status.link && !window.confirm("Rotate the registration link? The old URL will stop working. Existing accounts will stay active.")) return;
        void update({ action: "rotate" });
      }}>{status.link ? "Rotate registration link" : "Create registration link"}</button>
      {status.link ? <button type="button" disabled={pending} className="secondary-button" onClick={() => void update({ enabled: !status.link?.enabled })}>{status.link.enabled ? "Disable registrations" : "Enable registrations"}</button> : null}
      {url ? <ShareLink url={url} label="Team registration link" /> : null}
      <p className="text-xs text-quiet">Copy and save the URL when created. Only its hash is stored, so it cannot be recovered after leaving this screen. Rotate if it is lost or shared outside the team.</p>
    </section>}
    <section className="panel"><h2 className="font-heading font-semibold">Recently credentialed players</h2>
      <p className="text-sm text-quiet">New registrations and existing players who added a username.</p>
      {!status?.players.length ? <p className="text-sm text-quiet">No player credentials yet.</p> : <ul className="flex flex-col gap-s2">{status.players.map(p =>
        <li key={p.id}><p className="font-heading font-semibold break-words">{p.name}</p><p className="text-sm text-quiet break-words">@{p.username} · {p.status} · {displayDate(new Date(p.created_at).toISOString().slice(0, 10))}</p></li>)}</ul>}
      <Link to="/members" className="secondary-button">Manage or deactivate members</Link>
    </section>
  </main>;
}
