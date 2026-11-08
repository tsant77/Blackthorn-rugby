import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useSession } from "../session";

export function InvitePage() {
  const { me } = useSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("player");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (me?.membership.role !== "admin") {
    return <main className="px-s2 py-s4 text-quiet">Only an admin can send invitations.</main>;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api("/api/invitations", { method: "POST", body: JSON.stringify({ email, role }) });
      setMessage(`Invitation sent to ${email}.`);
      setEmail("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not send the invite.");
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Invite</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2 shadow-card">
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
          />
        </label>
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink">
            <option value="player">Player</option>
            <option value="coach">Coach</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
        <button type="submit" className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">
          Send invite
        </button>
      </form>
    </main>
  );
}
