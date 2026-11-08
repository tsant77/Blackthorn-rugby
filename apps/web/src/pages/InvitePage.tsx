import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { ShareLink } from "../components/ShareLink";
import { useSession } from "../session";

export function InvitePage() {
  const { me } = useSession();
  const [label, setLabel] = useState("");
  const [role, setRole] = useState("player");
  const [url, setUrl] = useState<string | null>(null);
  const [clubUrl, setClubUrl] = useState<string | null>(null);
  const [landing, setLanding] = useState("player");
  const [days, setDays] = useState("14");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ emailEnabled: boolean }>("/api/auth/options").then((body) => setEmailEnabled(body.emailEnabled)).catch(() => setEmailEnabled(false));
  }, []);

  if (me?.membership.role !== "admin") {
    return <main className="px-s2 py-s4 text-quiet">Only an admin can create invite links.</main>;
  }

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (emailEnabled && email) {
        const sent = await api<{ url?: string }>("/api/invitations", { method: "POST", body: JSON.stringify({ email, role }) });
        setUrl(sent.url ?? null);
        return;
      }
      const created = await api<{ url: string }>("/api/share-invites", { method: "POST", body: JSON.stringify({ label, role }) });
      setUrl(created.url);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the link.");
    }
  }

  async function onClub(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api<{ url: string }>("/api/join-link", {
        method: "POST",
        body: JSON.stringify({ landing, days: Number(days) }),
      });
      setClubUrl(created.url);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the club link.");
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Invite</h1>
      <p className="text-quiet">Copy the link into a text or the team chat. Each personal link works once.</p>
      <form onSubmit={onInvite} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Name
          <input value={label} onChange={(event) => setLabel(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink" />
        </label>
        {emailEnabled ? (
          <label className="flex flex-col gap-s1 text-sm text-quiet">
            Email, optional
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink" />
          </label>
        ) : null}
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink">
            <option value="player">Player</option>
            <option value="coach">Coach</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">Create link</button>
        {url ? <ShareLink url={url} label="Invite link" /> : null}
      </form>
      <form onSubmit={onClub} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
        <h2 className="font-heading font-semibold">Club join link</h2>
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          New people join as
          <select aria-label="Landing" value={landing} onChange={(event) => setLanding(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-ink">
            <option value="player">Player</option>
            <option value="pending">Pending</option>
          </select>
        </label>
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Expires in days
          <input value={days} onChange={(event) => setDays(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-ink" />
        </label>
        <div className="flex flex-wrap gap-s1">
          <button type="submit" className="rounded-md border border-line px-s2 py-s1 font-heading font-semibold">Create or rotate</button>
          <button type="button" className="text-sm text-gold-soft" onClick={() => void api("/api/join-link/disable", { method: "POST" }).then(() => setClubUrl(null))}>Disable</button>
        </div>
        {clubUrl ? <ShareLink url={clubUrl} label="Club link" /> : null}
      </form>
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
    </main>
  );
}
