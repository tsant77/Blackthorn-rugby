import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useSession } from "../session";
import { CredentialFields, type CredentialValues } from "./CredentialFields";

export function AccountCredentials() {
  const { refresh } = useSession();
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [values, setValues] = useState<CredentialValues>({ username: "", password: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  useEffect(() => { void api<{ username: string | null }>("/api/me/credentials").then(body => setUsername(body.username)).catch(() => setError("Could not load account credentials.")); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (values.password !== values.confirmPassword) { setError("Passwords do not match."); return; }
    busy.current = true; setPending(true); setError(null);
    try {
      await api("/api/me/credentials", { method: "POST", body: JSON.stringify(values) });
      setUsername(values.username.toLowerCase().trim()); setValues({ username: "", password: "", confirmPassword: "" }); await refresh();
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not establish credentials."); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="panel">
    <h2 className="font-heading font-semibold">Account & security</h2>
    {error ? <p role="alert" className="error-banner">{error}</p> : null}
    {username === undefined && !error ? <p role="status" className="text-sm text-quiet">Loading account…</p>
      : username ? <><p className="font-heading font-semibold break-words">@{username}</p><p className="text-sm text-quiet">Use your username and password on any device. To reset your password, ask an administrator for a single-use reset link.</p></>
        : username === null ? <><p className="text-sm text-quiet">Keep your existing workouts and points. Add a username and password to sign in from any device. This signs out older sessions and device sign-in links.</p>
          <form onSubmit={submit} className="flex flex-col gap-s2"><CredentialFields values={values} onChange={setValues} />
            <button type="submit" disabled={pending} className="save-workout">{pending ? "Saving…" : "Set up username & password"}</button>
          </form></> : null}
  </section>;
}
