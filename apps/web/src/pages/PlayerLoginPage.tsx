import { useLinkToken } from "../hooks/useLinkToken";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useSession } from "../session";

export function PlayerLoginPage() {
  const token = useLinkToken();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const { refresh } = useSession();
  const navigate = useNavigate();
  useEffect(() => { setError(null); }, [token]);
  async function signIn() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ token }) });
      await refresh(); navigate("/", { replace: true });
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not sign in. Reopen your saved link and try again."); }
    finally { busy.current = false; setPending(false); }
  }
  return <main className="auth-page"><h1 className="font-heading text-2xl font-semibold">Personal player login</h1>
    <section className="panel">
      <p>Sign in to the player account for this personal link.</p>
      <p className="text-sm text-quiet">Keep the original link somewhere private so you can use it on another device. Anyone with it can access your player account.</p>
      {error ? <p role="alert" className="error-banner">{error}</p> : null}
      {token ? <button type="button" className="save-workout" disabled={pending} onClick={() => void signIn()}>{pending ? "Signing in…" : "Sign in"}</button>
        : <p>Open your saved personal link. If you lost it, ask a coach or administrator for a replacement.</p>}
    </section><Link to="/login" className="text-sm text-sage underline">Back to sign in</Link>
  </main>;
}
