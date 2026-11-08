import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { ShareLink } from "./ShareLink";

export function AccountCredentials() {
  const [status, setStatus] = useState<{ exists: boolean; player: boolean } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => { void api<{ exists: boolean; player: boolean }>("/api/me/login-link").then(setStatus).catch(() => setError("Could not load account access.")); }, []);
  async function rotate() {
    if (busy.current) return;
    if (status?.exists && !window.confirm("Replace your personal login link? The old link and other sessions will stop working.")) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const body = await api<{ url: string }>("/api/me/login-link", { method: "POST", body: JSON.stringify({ action: "rotate" }) });
      setUrl(body.url); setStatus({ exists: true, player: true });
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not create your link."); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="panel"><h2 className="font-heading font-semibold">Account & security</h2>
    {error ? <p role="alert" className="error-banner">{error}</p> : null}
    {!status && !error ? <p role="status">Loading account…</p> : status?.player ? <>
      <p className="text-sm text-quiet">Your personal login link opens your account on another device. Save it privately. Anyone with it can access your account. Ask a coach or administrator for help if you lose it.</p>
      <button type="button" className="save-workout" disabled={pending} onClick={() => void rotate()}>{pending ? "Creating…" : status.exists ? "Replace personal login link" : "Create personal login link"}</button>
      {url ? <ShareLink url={url} label="Personal login link" /> : null}
      <p className="text-xs text-quiet">Links are shown only when created. Replacing one signs out other devices and preserves all your workouts and points.</p>
    </> : status ? <p className="text-sm text-quiet">Staff access uses separate administrator-issued links. Keep a trusted administrator access path saved privately.</p> : null}
  </section>;
}
