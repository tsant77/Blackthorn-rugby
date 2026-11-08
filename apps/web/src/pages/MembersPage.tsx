import { useEffect, useState } from "react";
import { api, ApiError, type RosterPosition } from "../api";
import { useSession } from "../session";

interface Member {
  membership_id: string;
  role: string;
  status: string;
  email: string;
  name: string;
  profile_id: string | null;
  roster_name: string | null;
  position_id: string | null;
  injury_status: string | null;
  injury_note: string | null;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  accepted_at: number | null;
  expires_at: number;
}

export function MembersPage() {
  const { me } = useSession();
  const admin = me?.membership.role === "admin";
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invite[]>([]);
  const [positions, setPositions] = useState<RosterPosition[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const body = await api<{ members: Member[]; invitations: Invite[] }>("/api/members");
    setMembers(body.members);
    setInvitations(body.invitations);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load members."));
    void api<{ positions: RosterPosition[] }>("/api/roster-options").then((body) => setPositions(body.positions));
  }, []);

  async function updateMember(id: string, patch: { role?: string; status?: string }) {
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
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      <ul className="flex flex-col gap-s2">
        {members.map((member) => (
          <li key={member.membership_id} className="rounded-md border border-line bg-raised p-s2">
            <p className="font-heading font-semibold">{member.roster_name ?? member.name}</p>
            <p className="text-sm text-quiet">{member.email} · {member.role} · {member.status}</p>
            {admin ? (
              <div className="mt-s1 flex flex-wrap items-end gap-s2">
                <label className="flex flex-col gap-s1 text-sm text-quiet">
                  Role
                  <select
                    aria-label={`Role for ${member.email}`}
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
                    aria-label={`Position for ${member.roster_name ?? member.email}`}
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
                    aria-label={`Availability for ${member.roster_name ?? member.email}`}
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
                    aria-label={`Injury note for ${member.roster_name ?? member.email}`}
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
      <h2 className="font-heading text-xl font-semibold">Invitations</h2>
      <ul className="flex flex-col gap-s1">
        {invitations.map((invite) => (
          <li key={invite.id} className="flex items-center justify-between gap-s2 text-sm">
            <span>{invite.email} · {invite.role} · {invite.accepted_at ? "accepted" : "pending"}</span>
            {admin && !invite.accepted_at ? (
              <span className="flex gap-s1">
                <button type="button" className="text-sage" onClick={() => void api(`/api/invitations/${invite.id}/resend`, { method: "POST" }).then(load)}>Resend</button>
                <button type="button" className="text-gold-soft" onClick={() => void api(`/api/invitations/${invite.id}/revoke`, { method: "POST" }).then(load)}>Revoke</button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
