import { Footprints, Dumbbell, Waves, Timer, CircleDot, Shield, Goal, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { displayDate } from "../lib/dates";
import { formulaTenths, formatPoints, type ScoringRule } from "@blackthorn/scoring";
import { api, ApiError } from "../api";

const TYPES = [
  ["running", "Running"],
  ["weight_training", "Weights"],
  ["rower", "Rower"],
  ["circuit_training", "Circuit"],
  ["basketball", "Basketball"],
  ["rugby", "Rugby"],
  ["football", "Football"],
] as const;

const ICONS = [Footprints, Dumbbell, Waves, Timer, CircleDot, Shield, Goal];

const INTENSITIES = ["easy", "moderate", "hard", "max"] as const;

interface Workout {
  id: string;
  type: string;
  activity_label?: string;
  occurred_on: string;
  duration_min: number;
  intensity: string | null;
  distance_miles: number | null;
  notes: string | null;
  status: string;
  review_note: string | null;
  points_tenths: number;
}

export function LogPage() {
  const [type, setType] = useState<string>("running");
  const [durationMin, setDurationMin] = useState("");
  const [intensity, setIntensity] = useState<(typeof INTENSITIES)[number]>("moderate");
  const [distanceMiles, setDistanceMiles] = useState("");
  const [notes, setNotes] = useState("");
  const [today, setToday] = useState("");
  const [minDate, setMinDate] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const [estimateRule, setEstimateRule] = useState<ScoringRule | null>(null);
  const duration = Number(durationMin);
  const multiplier = estimateRule?.types[type]?.multiplierHundredths;
  const estimate = estimateRule && multiplier != null && Number.isInteger(duration) && duration >= 1 && duration <= 240
    ? Math.min(estimateRule.sessionCapTenths, formulaTenths(duration, multiplier, estimateRule.intensityHundredths[intensity])) : null;
  const distance = estimateRule?.types[type]?.allowsDistance ?? (type === "running" || type === "rower");
  const types = estimateRule ? Object.entries(estimateRule.types).filter(([,r])=>r.enabled!==false).map(([id,r])=>[id,r.label ?? TYPES.find(t=>t[0]===id)?.[1] ?? id.replaceAll("_"," ")] as const) : TYPES;

  async function load() {
    const body = await api<{ today: string; minDate: string; workouts: Workout[]; estimateRule?: ScoringRule }>("/api/workouts");
    setEstimateRule(body.estimateRule ?? null);
    setToday(body.today);
    setMinDate(body.minDate);
    setOccurredOn((current) => current || body.today);
    setWorkouts(body.workouts);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load workouts."));
  }, []);

  useEffect(() => {
    if (!occurredOn) return;
    let active = true;
    const query = new URLSearchParams({ date:occurredOn,...(editing?{workoutId:editing}:{}) });
    void api<{ rule:ScoringRule }>(`/api/scoring-estimate?${query}`).then(body=>{if(active)setEstimateRule(body.rule);}).catch(()=>{if(active)setError("Could not load scoring for that date.");});
    return ()=>{active=false;};
  },[occurredOn,editing]);

  function resetForm() {
    request.current = null;
    setDurationMin("");
    setDistanceMiles("");
    setNotes("");
    setEditing(null);
    setIntensity("moderate");
    setOccurredOn(today);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setResult(null);
    const payload: Record<string, unknown> = {
      type,
      occurredOn,
      durationMin: Number(durationMin),
      intensity,
      notes,
    };
    if (distance && distanceMiles) payload.distanceMiles = Number(distanceMiles);
    if (!editing) {
      const fingerprint = JSON.stringify(payload);
      if (request.current?.payload !== fingerprint) request.current = { payload: fingerprint, id: crypto.randomUUID() };
      payload.clientRequestId = request.current.id;
    }
    try {
      const path = editing ? `/api/workouts/${editing}` : "/api/workouts";
      const saved = await api<{ awardedPointsTenths?: number; flags?: string[]; workout?: Workout; idempotent?: boolean }>(path, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const capped = saved.flags?.includes("daily_cap") || saved.flags?.includes("session_cap");
      const awarded = saved.awardedPointsTenths ?? saved.workout?.points_tenths;
      if (awarded == null) throw new Error("Missing saved workout points.");
      setResult(`${formatPoints(awarded)} points${capped ? " after the cap" : ""}${saved.idempotent ? " · already saved" : ""}`);
      resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the workout.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this workout? Points come off the board.")) return;
    try {
      await api(`/api/workouts/${id}`, { method: "DELETE" });
      if (editing === id) resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not delete the workout.");
    }
  }

  function startEdit(workout: Workout) {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    setEditing(workout.id);
    setType(workout.type);
    setDurationMin(String(workout.duration_min));
    setIntensity((workout.intensity as (typeof INTENSITIES)[number]) ?? "moderate");
    setDistanceMiles(workout.distance_miles == null ? "" : String(workout.distance_miles));
    setNotes(workout.notes ?? "");
    setOccurredOn(workout.occurred_on);
    setResult(null);
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <div>
        <p className="eyebrow">PUT IN THE WORK</p>
        <h1 className="font-heading text-2xl font-semibold">{editing ? "Edit workout" : "Log a workout"}</h1>
        <p className="text-sm text-quiet">Eastern Time. You can log up to 7 days back.</p>
      </div>
      {result ? <p role="status" className="success-banner"><CheckCircle2 aria-hidden="true" /><span><strong className="block">Workout saved</strong>{result}</span></p> : null}
      <form onSubmit={onSubmit} className="workout-form">
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-s2">
        <h2 className="section-label">01 <span>Choose your activity</span></h2>
        <div className="activity-grid" role="group" aria-label="Workout type">
          {types.map(([value, label], index) => {
            const Icon = ICONS[index] ?? Timer;
            return (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
              className={`activity-card ${type === value ? "selected" : ""}`}
            >
              <Icon size={23} aria-hidden="true" />
              {label}
            </button>
            );
          })}
        </div>
        <h2 className="section-label">02 <span>Session details</span></h2>
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Date
          <input
            type="date"
            required
            min={minDate}
            max={today}
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
            className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
          />
        </label>
        <div role="group" aria-label="Duration presets" className="grid grid-cols-4 gap-s1">
          {[20, 30, 45, 60].map((minutes) => <button key={minutes} type="button" aria-pressed={durationMin === String(minutes)} className="duration-preset" onClick={() => setDurationMin(String(minutes))}>{minutes} min</button>)}
        </div>
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Minutes
          <input
            required
            type="number"
            placeholder="Custom duration"
            inputMode="numeric"
            min={1}
            max={240}
            value={durationMin}
            onChange={(event) => setDurationMin(event.target.value)}
            className="custom-duration rounded-md border border-line bg-canvas px-s2 py-s2 font-display text-3xl text-ink"
          />
        </label>
        <p className="text-sm text-quiet">Intensity</p>
        <div className="grid grid-cols-4 gap-s1" role="group" aria-label="Intensity">
          {INTENSITIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={intensity === value}
              onClick={() => setIntensity(value)}
              className={`min-h-11 rounded-md border text-sm capitalize ${intensity === value ? "border-gold bg-gold text-forest" : "border-line text-quiet"}`}
            >
              {value}
            </button>
          ))}
        </div>
        {distance ? (
          <label className="flex flex-col gap-s1 text-sm text-quiet">
            Miles, optional
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={distanceMiles}
              onChange={(event) => setDistanceMiles(event.target.value)}
              className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-s1 text-sm text-quiet">
          Notes, optional
          <textarea
            rows={3}
            placeholder="How did the session feel?"
            value={notes}
            maxLength={500}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink"
          />
        </label>
        {error ? <p role="alert" className="error-banner">{error}</p> : null}
        {estimate != null ? <div className="estimate-preview" aria-live="polite"><p>Estimated <strong>{formatPoints(estimate)} PTS</strong></p><p className="text-xs text-quiet">Before daily caps and training limits. Final points confirmed on save.</p></div> : null}
        <button type="submit" disabled={pending || !today} className="save-workout disabled:opacity-60">
          {pending ? "Saving…" : editing ? "Save changes" : "Save workout"}
        </button>
        {editing ? (
          <button type="button" onClick={resetForm} className="text-quiet">
            Cancel edit
          </button>
        ) : null}
        </fieldset>
      </form>
      <section className="flex flex-col gap-s2">
        <h2 className="font-heading font-semibold">Your sessions</h2>
        {workouts.length === 0 ? <p className="text-quiet">Nothing logged yet.</p> : null}
        <ul className="flex flex-col gap-s1">
          {workouts.map((workout) => (
            <li key={workout.id} className="session-card">
              <div className="flex-1">
                <p className="font-heading font-semibold capitalize">{workout.activity_label ?? workout.type.replaceAll("_", " ")}</p>
                <p className="text-sm text-quiet">{displayDate(workout.occurred_on)} · {workout.duration_min} min · {sessionLabel(workout.status, workout.review_note)}</p>
                <p className="mt-half text-xs capitalize text-sage">{workout.intensity}{workout.distance_miles != null ? ` · ${workout.distance_miles} miles` : ""}</p>
                {workout.notes ? <p className="mt-s1 text-sm text-quiet break-words">{workout.notes}</p> : null}
                {workout.review_note ? <p className="text-sm text-gold-soft">{workout.review_note}</p> : null}
              </div>
              <p className="font-display text-2xl text-gold">{formatPoints(workout.points_tenths)}<span className="block text-right font-body text-xs text-quiet">PTS</span></p>
              {workout.status === "submitted" ? (
                <div className="session-actions">
                  <button type="button" className="text-sm text-sage" disabled={pending} onClick={() => startEdit(workout)}>Edit</button>
                  <button type="button" className="text-sm text-gold-soft" disabled={pending} onClick={() => void remove(workout.id)}>Delete</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function sessionLabel(status: string, note: string | null): string {
  if (status === "rejected") return "Rejected · not a legitimate session";
  if (status === "voided" && note === "Deleted by the player") return "Deleted";
  if (status === "voided") return "Voided · logged by mistake";
  if (status === "approved") return "Approved";
  return "Submitted";
}
