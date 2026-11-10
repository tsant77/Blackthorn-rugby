import { useEffect, useState } from "react";
import { api, ApiError, type RosterPosition } from "../api";
import { ShareLink } from "../components/ShareLink";
import { useSession } from "../session";

interface Member {
  membership_id: string;
  role: string;
  status: string;
  user_id: string;
  user_status: string;
  name: string;
  profile_id: string | null;
  roster_name: string | null;
  position_id: string | null;
  injury_status: string | null;
  injury_note: string | null;
}

export function MembersPage() {
  const { me } = useSession();
  const admin = me?.membership.role === "admin";
  const [members, setMembers] = useState<Member[]>([]);
  const [positions, setPositions] = useState<RosterPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [resetMemberId, setResetMemberId] = useState<string | null>(null);
  const [resetPendingId, setResetPendingId] = useState<string | null>(null);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);

  async function load() {
    const body = await api<{ members: Member[] }>("/api/members");
    setMembers(body.members);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load members."));
    void api<{ positions: RosterPosition[] }>("/api/roster-options").then((body) => setPositions(body.positions));
  }, []);

  async function updateMember(id: string, patch: { role?: string; status?: string; approve?: boolean }) {
    setError(null);
    try {
      await api(`/api/members/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update the member.");
    }
  }

  async function updateProfile(id: string, patch: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/api/profiles/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update the profile.");
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Members</h1>
      <p className="text-sm text-quiet">Verify the player's identity before replacing a login link. Share it privately; replacement signs out their other devices.</p>
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      
      {signInUrl ? <ShareLink url={signInUrl} label="One-time sign-in link" /> : null}
      <ul className="flex flex-col gap-s2">
        {members.map((member) => (
          <li key={member.membership_id} className="rounded-md border border-line bg-raised p-s2">
            <p className="font-heading font-semibold">{member.roster_name ?? member.name}</p>
            <p className="text-sm text-quiet">{member.role} · {member.user_status === "invited" ? "pending" : member.status}</p>
            {member.user_status === "invited" && admin ? (
              <button type="button" className="text-sm text-sage" onClick={() => void updateMember(member.membership_id, { approve: true })}>Approve</button>
            ) : null}
            {member.role !== "player" && admin ? <button
              type="button"
              className="text-sm text-sage"
              onClick={() => void api<{ url: string }>("/api/signin-links", { method: "POST", body: JSON.stringify({ userId: member.user_id }) }).then((body) => setSignInUrl(body.url)).catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not create a sign-in link."))}
            >
              Staff sign-in link
            </button> : null}
            {member.role === "player" && member.status === "active" ? <>
              <button type="button" disabled={resetPendingId !== null} className="secondary-button mt-s1" onClick={async () => {
                if (!window.confirm(`Replace the personal login link for ${member.roster_name ?? member.name}? Their previous link and sessions will stop working.`)) return;
                setError(null); setResetUrl(null); setResetMemberId(null); setResetPendingId(member.membership_id);
                try {
                  const body = await api<{ url: string }>("/api/player-login-links", { method: "POST", body: JSON.stringify({ userId: member.user_id, action: "rotate" }) });
                  setResetMemberId(member.membership_id); setResetUrl(body.url);
                } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not replace the login link."); }
                finally { setResetPendingId(null); }
              }}>{resetPendingId === member.membership_id ? "Generating replacement…" : `Replace login link for ${member.roster_name ?? member.name}`}</button>
              {resetMemberId === member.membership_id && resetUrl ? <div role="status" className="mt-s2"><p className="text-sm">Replacement created. Copy it now and share privately.</p><ShareLink url={resetUrl} label="Replacement personal login link" /></div> : null}
            </> : null}
            {member.role === "player" && member.status === "active" ? <button type="button" className="secondary-button" onClick={() => {
              if (!window.confirm("Revoke this player's login link and all sessions?")) return;
              setResetUrl(null);
              void api("/api/player-login-links", { method: "POST", body: JSON.stringify({ userId: member.user_id, action: "revoke" }) })
                .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not revoke the link."));
            }}>Revoke login link for {member.roster_name ?? member.name}</button> : null}
            {admin ? (
              <div className="mt-s1 flex flex-wrap items-end gap-s2">
                <label className="flex flex-col gap-s1 text-sm text-quiet">
                  Role
                  <select
                    aria-label={`Role for ${member.name}`}
                    value={member.role}
                    onChange={(event) => void updateMember(member.membership_id, { role: event.target.value })}
                    className="rounded-md border border-line bg-canvas px-s2 py-s1 text-ink"
                  >
                    <option value="player">Player</option>
                    <option value="coach">Coach</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <button type="button" className="text-sm text-gold-soft" onClick={() => void updateMember(member.membership_id, { status: member.status === "active" ? "deactivated" : "active" })}>
                  {member.status === "active" ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            ) : null}
            {member.profile_id ? (
              <div className="mt-s1 grid gap-s1">
                <label className="flex flex-col gap-s1 text-sm text-quiet">
                  Position
                  <select
                    aria-label={`Position for ${member.roster_name ?? member.name}`}
                    value={member.position_id ?? ""}
                    onChange={(event) => void updateProfile(member.profile_id!, event.target.value ? { positionId: event.target.value } : { clearPosition: true })}
                    className="rounded-md border border-line bg-canvas px-s2 py-s1 text-ink"
                  >
                    <option value="">No position</option>
                    {positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-s1 text-sm text-quiet">
                  Availability
                  <select
                    aria-label={`Availability for ${member.roster_name ?? member.name}`}
                    value={member.injury_status ?? "available"}
                    onChange={(event) => void updateProfile(member.profile_id!, { injuryStatus: event.target.value })}
                    className="rounded-md border border-line bg-canvas px-s2 py-s1 text-ink"
                  >
                    <option value="available">Available</option>
                    <option value="limited">Limited</option>
                    <option value="out">Out</option>
                  </select>
                </label>
                <label className="flex flex-col gap-s1 text-sm text-quiet">
                  Injury note
                  <input
                    aria-label={`Injury note for ${member.roster_name ?? member.name}`}
                    defaultValue={member.injury_note ?? ""}
                    onBlur={(event) => {
                      if (event.target.value !== (member.injury_note ?? "")) {
                        void updateProfile(member.profile_id!, { injuryNote: event.target.value });
                      }
                    }}
                    className="rounded-md border border-line bg-canvas px-s2 py-s1 text-ink"
                  />
                </label>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
