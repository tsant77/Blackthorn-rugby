import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";

export function LoginPage() {
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api<{ emailEnabled: boolean }>("/api/auth/options").then((body) => setEmailEnabled(body.emailEnabled)).catch(() => setEmailEnabled(false));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await api("/api/auth/request", { method: "POST", body: JSON.stringify({ email }) });
      setMessage("If that email is on the club list, a sign-in link is on its way.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not send the link.");
    } finally {
      setPending(false);
    }
  }

  const linkError = new URLSearchParams(window.location.search).get("error");

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-s3 px-s2 py-s4">
      <header className="flex items-center gap-s2">
        <img src="/brand/logo.jpg" alt="Blackthorn Rugby Club crest" className="h-16 w-auto rounded-md bg-white p-half" />
        <div>
          <p className="font-heading text-sm font-semibold text-sage">Blackthorn Rugby</p>
          <h1 className="font-heading text-2xl font-semibold leading-tight">Offseason</h1>
        </div>
      </header>
      <section className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2 shadow-card">
        <p className="text-quiet">Ask a coach for a link. There is no password.</p>
        {linkError === "limited" ? <p role="alert" className="text-gold-soft">Too many attempts. Try again later.</p> : null}
        {linkError && linkError !== "limited" ? <p role="alert" className="text-gold-soft">That link is invalid or already used. Ask for a new one.</p> : null}
        {emailEnabled ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-s2">
            <label className="flex flex-col gap-s1 text-sm text-quiet">
              Email
              <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink" />
            </label>
            {message ? <p role="status">{message}</p> : null}
            {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
            <button type="submit" disabled={pending} className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">
              {pending ? "Sending…" : "Email me a link"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
