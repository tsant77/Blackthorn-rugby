import { Footprints, Dumbbell, Waves, Timer, CircleDot, Shield, Goal, CheckCircle2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { formatPoints } from "@blackthorn/scoring";
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
  const distance = type === "running" || type === "rower";

  async function load() {
    const body = await api<{ today: string; minDate: string; workouts: Workout[] }>("/api/workouts");
    setToday(body.today);
    setMinDate(body.minDate);
    setOccurredOn((current) => current || body.today);
    setWorkouts(body.workouts);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load workouts."));
  }, []);

  function resetForm() {
    setDurationMin("");
    setDistanceMiles("");
    setNotes("");
    setEditing(null);
    setIntensity("moderate");
    setOccurredOn(today);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
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
    if (!editing) payload.clientRequestId = crypto.randomUUID();
    try {
      const path = editing ? `/api/workouts/${editing}` : "/api/workouts";
      const saved = await api<{ awardedPointsTenths: number; flags: string[] }>(path, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const capped = saved.flags.includes("daily_cap") || saved.flags.includes("session_cap");
      setResult(`${formatPoints(saved.awardedPointsTenths)} points${capped ? " after the cap" : ""}`);
      resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the workout.");
    } finally {
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
      <form onSubmit={onSubmit} className="workout-form flex flex-col gap-s2">
        <h2 className="section-label">01 <span>Choose your activity</span></h2>
        <div className="activity-grid" role="group" aria-label="Workout type">
          {TYPES.map(([value, label], index) => {
            const Icon = ICONS[index]!;
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
            className="rounded-md border border-line bg-canvas px-s2 py-s2 font-display text-4xl text-ink"
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
        <button type="submit" disabled={pending} className="save-workout disabled:opacity-60">
          {pending ? "Saving…" : editing ? "Save changes" : "Save workout"}
        </button>
        {editing ? (
          <button type="button" onClick={resetForm} className="text-quiet">
            Cancel edit
          </button>
        ) : null}
      </form>
      <section className="flex flex-col gap-s2">
        <h2 className="font-heading font-semibold">Your sessions</h2>
        {workouts.length === 0 ? <p className="text-quiet">Nothing logged yet.</p> : null}
        <ul className="flex flex-col gap-s1">
          {workouts.map((workout) => (
            <li key={workout.id} className="session-card">
              <div className="flex-1">
                <p className="font-heading font-semibold capitalize">{workout.type.replaceAll("_", " ")}</p>
                <p className="text-sm text-quiet">{workout.occurred_on} · {workout.duration_min} min · {sessionLabel(workout.status, workout.review_note)}</p>
                <p className="mt-half text-xs capitalize text-sage">{workout.intensity}{workout.distance_miles != null ? ` · ${workout.distance_miles} miles` : ""}</p>
                {workout.notes ? <p className="mt-s1 text-sm text-quiet break-words">{workout.notes}</p> : null}
                {workout.review_note ? <p className="text-sm text-gold-soft">{workout.review_note}</p> : null}
              </div>
              <p className="font-display text-2xl text-gold">{formatPoints(workout.points_tenths)}<span className="block text-right font-body text-xs text-quiet">PTS</span></p>
              {workout.status === "submitted" ? (
                <>
                  <button type="button" className="text-sm text-sage" onClick={() => startEdit(workout)}>Edit</button>
                  <button type="button" className="text-sm text-gold-soft" onClick={() => void remove(workout.id)}>Delete</button>
                </>
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
