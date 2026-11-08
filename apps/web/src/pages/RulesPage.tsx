import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";

interface Rule {
  id: string;
  version: number;
  status: string;
  daily_cap_tenths: number;
  session_cap_tenths: number;
  weekly_load_limit: number;
  effective_on: string | null;
}

interface Season {
  id: string;
  name: string;
  start_on: string;
  end_on: string;
}

export function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [daily, setDaily] = useState("300");
  const [session, setSession] = useState("150");
  const [weekly, setWeekly] = useState("600");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [profileId, setProfileId] = useState("");
  const [points, setPoints] = useState("1.0");
  const [reason, setReason] = useState("");
  const [adjustOn, setAdjustOn] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [ruleBody, seasonBody, members] = await Promise.all([
      api<{ rules: Rule[] }>("/api/rules"),
      api<{ season: Season }>("/api/season"),
      api<{ members: { profile_id: string | null; roster_name: string | null; email: string }[] }>("/api/members"),
    ]);
    setRules(ruleBody.rules);
    setSeason(seasonBody.season);
    setAdjustOn((current) => current || seasonBody.season.start_on);
    const first = members.members.find((member) => member.profile_id);
    if (first?.profile_id) setProfileId(first.profile_id);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load rules."));
  }, []);

  async function onRule(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/rules", {
        method: "POST",
        body: JSON.stringify({
          dailyCapTenths: Number(daily),
          sessionCapTenths: Number(session),
          weeklyLoadLimit: Number(weekly),
          effectiveOn,
        }),
      });
      setMessage("New rule version saved. Past ledger rows stay as they are.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the rule.");
    }
  }

  async function onSeason(event: FormEvent) {
    event.preventDefault();
    if (!season) return;
    setError(null);
    try {
      await api("/api/season", {
        method: "PATCH",
        body: JSON.stringify({ name: season.name, startOn: season.start_on, endOn: season.end_on }),
      });
      setMessage("Offseason dates saved. Past ledger rows stay as they are.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the offseason.");
    }
  }

  async function onAdjust(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/adjustments", {
        method: "POST",
        body: JSON.stringify({
          profileId,
          pointsTenths: Math.round(Number(points) * 10),
          reason,
          occurredOn: adjustOn,
        }),
      });
      setMessage("Adjustment posted to the ledger.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not post the adjustment.");
    }
  }

  const active = rules.find((rule) => rule.status === "active");

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Scoring</h1>
      {active ? <p className="text-quiet">Active version {active.version}. Session {active.session_cap_tenths / 10}, day {active.daily_cap_tenths / 10}, week load {active.weekly_load_limit}.</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      <form onSubmit={onRule} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
        <h2 className="font-heading font-semibold">New version</h2>
        <Field label="Daily cap, tenths" value={daily} onChange={setDaily} />
        <Field label="Session cap, tenths" value={session} onChange={setSession} />
        <Field label="Weekly load, minutes" value={weekly} onChange={setWeekly} />
        <Field label="Effective date" value={effectiveOn} onChange={setEffectiveOn} type="date" />
        <button type="submit" className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">Save version</button>
      </form>
      {season ? (
        <form onSubmit={onSeason} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
          <h2 className="font-heading font-semibold">Offseason</h2>
          <Field label="Name" value={season.name} onChange={(name) => setSeason({ ...season, name })} />
          <Field label="Starts" value={season.start_on} onChange={(start_on) => setSeason({ ...season, start_on })} type="date" />
          <Field label="Ends" value={season.end_on} onChange={(end_on) => setSeason({ ...season, end_on })} type="date" />
          <button type="submit" className="rounded-md border border-line px-s2 py-s1 font-heading font-semibold">Save dates</button>
        </form>
      ) : null}
      <form onSubmit={onAdjust} className="flex flex-col gap-s2 rounded-md border border-line bg-raised p-s2">
        <h2 className="font-heading font-semibold">Manual adjustment</h2>
        <Field label="Points" value={points} onChange={setPoints} />
        <Field label="Adjustment date" value={adjustOn} onChange={setAdjustOn} type="date" />
        <Field label="Reason" value={reason} onChange={setReason} />
        <button type="submit" className="rounded-md border border-line px-s2 py-s1 font-heading font-semibold">Post adjustment</button>
      </form>
      <a className="text-sage" href="/api/export/workouts.csv">Download CSV</a>
      <AuditList />
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

function AuditList() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [events, setEvents] = useState<{ id: string; action: string; entity_type: string; actor_email: string | null; created_at: number }[]>([]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (entityType) params.set("entityType", entityType);
    if (from) params.set("from", String(Date.parse(from)));
    if (to) params.set("to", String(Date.parse(`${to}T23:59:59.999Z`)));
    const queryText = params.toString();
    const query = queryText ? `?${queryText}` : "";
    void api<{ events: { id: string; action: string; entity_type: string; actor_email: string | null; created_at: number }[] }>(`/api/audit${query}`).then((body) => setEvents(body.events));
  }, [action, entityType, from, to]);

  return (
    <section className="flex flex-col gap-s2">
      <h2 className="font-heading font-semibold">Audit log</h2>
      <div className="grid gap-s1">
        <Field label="Action" value={action} onChange={setAction} />
        <Field label="Entity" value={entityType} onChange={setEntityType} />
        <Field label="From" value={from} onChange={setFrom} type="date" />
        <Field label="To" value={to} onChange={setTo} type="date" />
      </div>
      <ul className="flex flex-col gap-s1 text-sm">
        {events.map((event) => (
          <li key={event.id} className="border-b border-line py-s1">
            {event.action} · {event.entity_type} · {event.actor_email ?? "system"}
          </li>
        ))}
      </ul>
    </section>
  );
}
