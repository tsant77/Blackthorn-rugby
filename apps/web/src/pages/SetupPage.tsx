import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useSession } from "../session";

export function SetupPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/api/setup", { method: "POST", body: JSON.stringify({ token, name }) });
      await refresh();
      navigate("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not finish setup.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Club setup</h1>
      <p className="text-quiet">This page works once. After it creates the first admin, the setup token is disabled.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Setup token
          <input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink" />
        </label>
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Your name
          <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink" />
        </label>
        {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
        <button type="submit" disabled={pending} className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">
          {pending ? "Creating…" : "Create admin"}
        </button>
      </form>
    </main>
  );
}
