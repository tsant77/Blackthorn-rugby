import { useLinkToken } from "../hooks/useLinkToken";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type RosterPosition } from "../api";
import { ShareLink } from "../components/ShareLink";
import { useSession } from "../session";

export function AccountAccessPage() {
  const [url, setUrl] = useState<string | null>(null);
  // Fragments are never sent in HTTP requests. Remove the fragment from browser history after capture.
  const token = useLinkToken();
  const [fullName, setFullName] = useState("");
  const [positionId, setPositionId] = useState("");
  const [positions, setPositions] = useState<RosterPosition[]>([]);
  const [groupId, setGroupId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const { me, refresh } = useSession();
  useEffect(() => {
    let active = true;
    void api<{ positions?: RosterPosition[] }>("/api/registration/options",
      { method: "POST", body: JSON.stringify({ token }) }).then(body => {
        if (!active) return;
        setPositions(body.positions ?? []);
        setLoaded(true);
      }).catch((caught: unknown) => { if (active) setError(caught instanceof ApiError ? caught.message : "Could not check this link. Please try again."); });
    return () => { active = false; };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const response = await api<{ url: string }>("/api/auth/register", {
        method: "POST", body: JSON.stringify({ token, fullName, positionId, groupId }),
      });
      setUrl(response.url); await refresh();
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not save your account. Try again."); }
    finally { busy.current = false; setPending(false); }
  }
  const groups = [...new Map(positions.map(p => [p.group_id, p.group_name])).entries()];
  return <main className="auth-page">
    <header className="flex items-center gap-s2">
      <img src="/brand/logo.jpg" alt="" className="h-10 w-auto rounded-md bg-white p-half" />
      <p className="eyebrow">BLACKTHORN RUGBY</p>
    </header>
    <div><h1 className="font-heading text-2xl font-semibold">{url ? "Save your personal login link" : "Join the team"}</h1>
      <p className="mt-s1 text-sm text-quiet">Create your player account. No email, password, or approval needed.</p></div>
    {error ? <p role="alert" className="error-banner">{error}</p> : null}
    {!loaded && !error ? <p role="status">Checking your link…</p> : null}
    {url ? <section className="panel"><p>Your account is ready and you are signed in. Save this personal link privately for use on another device. Anyone with it can access your account. It is shown only now.</p><ShareLink url={url} label="Personal login link" /><Link to="/" className="quick-log">Continue to dashboard</Link></section>
      : me ? <section className="panel"><p>You are already signed in. Save a personal login link in You to keep your existing training history.</p><Link to="/you" className="quick-log">Go to your account</Link></section>
      : loaded ? <form onSubmit={submit} className="panel">
        <label className="field">Full name<input required autoComplete="name" maxLength={60} value={fullName} onChange={e => setFullName(e.target.value)} /></label>
          <label className="field">Playing group
            <select required value={groupId} onChange={e => { setGroupId(e.target.value); setPositionId(""); }}>
              <option value="">Choose your group</option>{groups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="field">Rugby position
            <select required value={positionId} onChange={e => setPositionId(e.target.value)} disabled={!groupId}>
              <option value="">Choose your position</option>{positions.filter(p => p.group_id === groupId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <p className="text-xs text-quiet">You will join as a Player.</p>
        <button type="submit" disabled={pending} className="save-workout">{pending ? "Saving…" : "Create player account"}</button>
      </form> : null}
    <Link to="/login" className="text-sm text-sage underline">Already have an account? Sign in</Link>
  </main>;
}
