import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useSession } from "../session";

interface Standing {
  name: string;
  display: string;
  complete: boolean;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  startOn: string;
  endOn: string;
  status: string;
  scope: string;
  metric: string;
  target: number;
  summary: string;
  leaders: Standing[];
  sides: Standing[];
  mine: { display: string; complete: boolean } | null;
  closed: boolean;
}

export function ChallengesPage() {
  const { me } = useSession();
  const staff = me?.membership.role === "admin" || me?.membership.role === "coach";
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [today, setToday] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startOn, setStartOn] = useState("");
  const [endOn, setEndOn] = useState("");
  const [audience, setAudience] = useState("individual");
  const [metric, setMetric] = useState("sessions");
  const [target, setTarget] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const body = await api<{ today: string; challenges: Challenge[] }>("/api/challenges");
    setToday(body.today);
    setStartOn((current) => current || body.today);
    setEndOn((current) => current || body.today);
    setChallenges(body.challenges);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load challenges."));
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const scope = audience === "individual" ? "individual" : "group";
    const groupId = audience === "forwards" ? "group_forwards" : audience === "backs" ? "group_backs" : null;
    try {
      await api("/api/challenges", {
        method: "POST",
        body: JSON.stringify({ title, description, startOn, endOn, scope, metric, target: Number(target), groupId }),
      });
      setMessage("Challenge published.");
      setTitle("");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not publish the challenge.");
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Challenges</h1>
      <p className="text-quiet">Targets use workouts that count between the dates. They do not add points to the ledger.</p>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      {staff ? (
        <form onSubmit={onCreate} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
          <h2 className="font-heading font-semibold">New challenge</h2>
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Description" value={description} onChange={setDescription} />
          <Field label="Starts" value={startOn} onChange={setStartOn} type="date" />
          <Field label="Ends" value={endOn} onChange={setEndOn} type="date" />
          <label className="flex flex-col gap-s1 text-sm text-quiet">
            Who
            <select value={audience} onChange={(event) => setAudience(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-ink">
              <option value="individual">Each player</option>
              <option value="versus">Forwards vs backs</option>
              <option value="forwards">Forwards</option>
              <option value="backs">Backs</option>
            </select>
          </label>
          <label className="flex flex-col gap-s1 text-sm text-quiet">
            Metric
            <select value={metric} onChange={(event) => setMetric(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-ink">
              <option value="sessions">Sessions</option>
              <option value="minutes">Minutes</option>
              <option value="miles">Miles</option>
              <option value="points">Points</option>
            </select>
          </label>
          <Field label="Target" value={target} onChange={setTarget} />
          <button type="submit" className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">Publish</button>
        </form>
      ) : null}
      {challenges.length === 0 ? <p className="text-quiet">No challenges yet{today ? "" : ""}.</p> : null}
      <ul className="flex flex-col gap-s2">
        {challenges.map((challenge) => (
          <li key={challenge.id} className="rounded-md border border-line bg-raised p-s2">
            <p className="font-heading font-semibold">{challenge.title}</p>
            <p className="text-sm text-quiet">{challenge.startOn} to {challenge.endOn} · {challenge.metric} · target {challenge.target} · {challenge.status}</p>
            {challenge.description ? <p className="text-sm">{challenge.description}</p> : null}
            {challenge.mine ? <p>You: {challenge.mine.display}{challenge.mine.complete ? " · target met" : ""}</p> : null}
            {challenge.sides.length > 0 ? (
              <ul className="mt-s1 text-sm">
                {challenge.sides.map((side) => <li key={side.name}>{side.name}: {side.display}{side.complete ? " · target met" : ""}</li>)}
              </ul>
            ) : null}
            <p className="mt-s1 text-sm text-quiet">{challenge.closed ? "Result: " : ""}{challenge.summary}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-s1 text-sm text-quiet">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink" />
    </label>
  );
}
