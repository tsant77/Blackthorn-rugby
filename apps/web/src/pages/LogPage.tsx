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
  calories: number | null;
  calorie_source: string | null;
  exercises: {name:string;sets:number;reps:number;loadGrams:number}[];
  status: string;
  review_note: string | null;
  points_tenths: number;
}

export function LogPage() {
  const [type, setType] = useState<string>("running");
  const [durationMin, setDurationMin] = useState("");
  const [intensity, setIntensity] = useState<(typeof INTENSITIES)[number]>("moderate");
  const [distanceMiles, setDistanceMiles] = useState("");
  const [calories, setCalories] = useState("");
  const [calorieSource, setCalorieSource] = useState("device");
  const [distanceUnit, setDistanceUnit] = useState("mi");
  const [lifts, setLifts] = useState<{name:string;sets:string;reps:string;weight:string;unit:string}[]>([]);
  const [notes, setNotes] = useState("");
  const [today, setToday] = useState("");
  const [minDate, setMinDate] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const historyGeneration = useRef(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
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
    const generation = ++historyGeneration.current;
    const body = await api<{ today: string; minDate: string; workouts: Workout[]; nextCursor: string | null; estimateRule?: ScoringRule }>("/api/workouts");
    if (generation !== historyGeneration.current) return;
    setEstimateRule(body.estimateRule ?? null);
    setToday(body.today);
    setMinDate(body.minDate);
    setOccurredOn((current) => current || body.today);
    setWorkouts(body.workouts);
    setNextCursor(body.nextCursor);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const generation = historyGeneration.current;
    try {
      const query = new URLSearchParams({ cursor: nextCursor, context: "none" });
      const page = await api<{ workouts: Workout[]; nextCursor: string | null }>(`/api/workouts?${query}`);
      if (generation !== historyGeneration.current) return;
      setWorkouts(current => {
        const have = new Set(current.map(workout => workout.id));
        return [...current, ...page.workouts.filter(workout => !have.has(workout.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not load older workouts."); }
    finally { setLoadingMore(false); }
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
    setCalories(""); setCalorieSource("device"); setLifts([]); setDistanceUnit("mi");
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
    if (distance && distanceMiles) payload[distanceUnit === "mi" ? "distanceMiles" : "distanceKilometers"] = Number(distanceMiles);
    payload.calories = calories ? Number(calories) : null;
    payload.calorieSource = calories ? calorieSource : null;
    payload.exercises = lifts.map(lift => ({ name:lift.name, sets:lift.sets?Number(lift.sets):undefined, reps:Number(lift.reps), loadGrams:Math.round(Number(lift.weight)*(lift.unit==="lb"?453.59237:1000)) }));
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
    setDistanceUnit("mi"); setCalories(workout.calories == null ? "" : String(workout.calories));
    setCalorieSource(workout.calorie_source ?? "device");
    setLifts((workout.exercises ?? []).map(e=>({name:e.name,sets:String(e.sets),reps:String(e.reps),weight:String(e.loadGrams/1000),unit:"kg"})));
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
            {distanceUnit === "mi" ? "Miles, optional" : "Kilometers, optional"}
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
        {distance ? <label className="flex flex-col gap-s1 text-sm text-quiet">Distance unit<select value={distanceUnit} onChange={e=>{setDistanceMiles("");setDistanceUnit(e.target.value);}}><option value="mi">Miles</option><option value="km">Kilometers</option></select></label> : null}
        <details open={editing ? true : undefined} className="panel">
          <summary className="font-heading font-semibold">Optional performance details</summary>
          <p className="text-sm text-quiet">These details do not add points. Manage sharing in You → My progress.</p>
          <label className="flex flex-col gap-s1">Calories<input type="number" min="1" max="10000" value={calories} onChange={e=>setCalories(e.target.value)} /></label>
          <label className="flex flex-col gap-s1">Calorie source<select value={calorieSource} onChange={e=>setCalorieSource(e.target.value)}><option value="device">Device-reported (unverified)</option><option value="estimated">Estimated</option></select></label>
          <p className="text-sm text-quiet">Record the weight per rep. PRs compare the same exercise and rep count.</p>
          {lifts.map((lift,index)=><fieldset key={index} className="my-s2 flex min-w-0 flex-col gap-s1"><legend>Exercise {index+1}</legend>
            <label>Exercise<select value={lift.name} onChange={e=>setLifts(lifts.map((v,i)=>i===index?{...v,name:e.target.value}:v))}>{["leg press","squat","bench press"].map(name=><option key={name}>{name}</option>)}</select></label>
            {(["sets","reps","weight"] as const).map(key=><label key={key}>{key === "sets" ? "Sets, optional" : key === "reps" ? "Reps" : "Weight"}<input required={key!=="sets"} type="number" min={key==="weight"?0.01:1} max={key==="sets"?100:key==="reps"?1000:lift.unit==="lb"?881:400} step={key==="weight"?"any":1} value={lift[key]} onChange={e=>setLifts(lifts.map((v,i)=>i===index?{...v,[key]:e.target.value}:v))} /></label>)}
            <label>Weight unit<select value={lift.unit} onChange={e=>setLifts(lifts.map((v,i)=>i===index?{...v,weight:"",unit:e.target.value}:v))}><option value="lb">lb</option><option value="kg">kg</option></select></label>
            <button type="button" onClick={()=>setLifts(lifts.filter((_,i)=>i!==index))}>Remove exercise {index+1}</button>
          </fieldset>)}
          <button type="button" disabled={lifts.length>=20} onClick={()=>setLifts([...lifts,{name:"bench press",sets:"",reps:"5",weight:"",unit:"lb"}])}>Add exercise</button>
        </details>
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
                {workout.calories != null ? <p className="text-xs text-quiet">{workout.calories} kcal · {workout.calorie_source === "device" ? "device-reported (unverified)" : "estimated"}</p> : null}
                {(workout.exercises ?? []).map((e,i)=><p key={i} className="text-xs text-quiet capitalize">{e.name} · {e.sets} × {e.reps} × {(e.loadGrams/1000).toFixed(2)} kg</p>)}
                {workout.distance_miles ? <p className="text-xs text-quiet">Average pace: {(workout.duration_min / (workout.distance_miles*1.609344)).toFixed(2)} min/km</p> : null}
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
        {nextCursor ? <button type="button" disabled={loadingMore || pending} onClick={() => void loadMore()} className="text-sage">{loadingMore ? "Loading…" : "Load older sessions"}</button> : null}
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
