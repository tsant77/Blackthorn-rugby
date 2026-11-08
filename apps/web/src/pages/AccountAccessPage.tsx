import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type RosterPosition } from "../api";
import { CredentialFields, type CredentialValues } from "../components/CredentialFields";
import { useSession } from "../session";

export function AccountAccessPage({ reset = false }: { reset?: boolean }) {
  // Fragments are never sent in HTTP requests. Remove the fragment from browser history after capture.
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [values, setValues] = useState<CredentialValues>({ username: "", password: "", confirmPassword: "" });
  const [fullName, setFullName] = useState("");
  const [positionId, setPositionId] = useState("");
  const [positions, setPositions] = useState<RosterPosition[]>([]);
  const [groupId, setGroupId] = useState("");
  const [needsUsername, setNeedsUsername] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const busy = useRef(false);
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    void api<{ positions?: RosterPosition[]; needsUsername?: boolean }>(reset ? "/api/auth/reset/options" : "/api/registration/options",
      { method: "POST", body: JSON.stringify({ token }) }).then(body => {
        if (!active) return;
        setPositions(body.positions ?? []);
        setNeedsUsername(body.needsUsername ?? true);
        setLoaded(true);
      }).catch((caught: unknown) => { if (active) setError(caught instanceof ApiError ? caught.message : "Could not check this link. Please try again."); });
    return () => { active = false; };
  }, [reset, token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (values.password !== values.confirmPassword) { setError("Passwords do not match."); return; }
    busy.current = true; setPending(true); setError(null);
    try {
      await api(reset ? "/api/auth/reset" : "/api/auth/register", {
        method: "POST", body: JSON.stringify({ token, ...values, fullName, positionId, groupId }),
      });
      setValues({ username: "", password: "", confirmPassword: "" });
      if (reset) { setComplete(true); return; }
      await refresh(); navigate("/", { replace: true });
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not save your account. Try again."); }
    finally { busy.current = false; setPending(false); }
  }
  const groups = [...new Map(positions.map(p => [p.group_id, p.group_name])).entries()];
  return <main className="auth-page">
    <header className="flex items-center gap-s2">
      <img src="/brand/logo.jpg" alt="" className="h-10 w-auto rounded-md bg-white p-half" />
      <p className="eyebrow">BLACKTHORN RUGBY</p>
    </header>
    <div><h1 className="font-heading text-2xl font-semibold">{reset ? "Choose a new password" : "Join the team"}</h1>
      <p className="mt-s1 text-sm text-quiet">{reset ? "Your old sessions will be signed out. Then sign in with your new password." : "Create your player account. No email or approval needed."}</p></div>
    {error ? <p role="alert" className="error-banner">{error}</p> : null}
    {!loaded && !error ? <p role="status">Checking your link…</p> : null}
    {complete ? <section className="panel"><p role="status">Password updated. Sign in with your new password.</p><Link to="/login" className="quick-log">Go to sign in</Link></section>
      : !reset && me ? <section className="panel"><p>You are already signed in. Keep your training history by setting up credentials in You.</p><Link to="/you" className="quick-log">Go to your account</Link></section>
      : loaded ? <form onSubmit={submit} className="panel">
        {!reset ? <label className="field">Full name<input required autoComplete="name" maxLength={60} value={fullName} onChange={e => setFullName(e.target.value)} /></label> : null}
        <CredentialFields values={values} onChange={setValues} username={!reset || needsUsername} />
        {!reset ? <>
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
        </> : null}
        <button type="submit" disabled={pending} className="save-workout">{pending ? "Saving…" : reset ? "Reset password" : "Create player account"}</button>
      </form> : null}
    <Link to="/login" className="text-sm text-sage underline">Already have an account? Sign in</Link>
  </main>;
}
