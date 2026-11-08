import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { CredentialFields, type CredentialValues } from "../components/CredentialFields";
import { useSession } from "../session";

export function LoginPage() {
  const [values, setValues] = useState<CredentialValues>({ username: "", password: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const { refresh } = useSession();
  const navigate = useNavigate();
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: values.username, password: values.password }) });
      setValues({ username: "", password: "", confirmPassword: "" });
      await refresh();
      navigate("/", { replace: true });
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not sign in. Try again."); }
    finally { busy.current = false; setPending(false); }
  }
  const linkError = new URLSearchParams(window.location.search).get("error");
  return (
    <main className="auth-page">
      <header className="flex items-center gap-s2">
        <img src="/brand/logo.jpg" alt="Blackthorn Rugby Club crest" className="h-12 w-auto rounded-md bg-white p-half" />
        <div><p className="eyebrow">BLACKTHORN RUGBY</p><h1 className="font-heading text-2xl font-semibold">Offseason</h1></div>
      </header>
      <section className="panel">
        <h2 className="font-heading text-xl font-semibold">Welcome back</h2>
        <p className="text-sm text-quiet">Your team. Your training. Sign in to keep building.</p>
        {linkError === "limited" ? <p role="alert" className="error-banner">Too many attempts. Try again later.</p>
          : linkError ? <p role="alert" className="error-banner">That link is invalid or already used. Ask for a new one.</p> : null}
        <form onSubmit={onSubmit} className="flex flex-col gap-s2">
          <CredentialFields values={values} onChange={setValues} confirm={false} />
          {error ? <p role="alert" className="error-banner">{error}</p> : null}
          <button type="submit" disabled={pending} className="save-workout">{pending ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
      <p className="text-sm text-quiet">New player? Open the team registration link from WhatsApp.</p>
      <p className="text-sm text-quiet">Forgot your password? Ask a club administrator for a reset link. Existing link accounts can still sign in with their saved link, then set up credentials in You.</p>
      <p className="text-sm text-quiet">Ask a coach for a link.</p>
    </main>
  );
}
