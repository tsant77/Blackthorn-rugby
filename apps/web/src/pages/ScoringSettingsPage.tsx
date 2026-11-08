import { useEffect, useState, type FormEvent } from "react";
import {
  defaultRule,
  FITNESS_CATEGORIES,
  INTENSITIES,
  formatPoints,
  type ScoringRule,
  type TypeRule,
} from "@blackthorn/scoring";
import { api, ApiError } from "../api";
import { useSession } from "../session";

interface Version {
  id: string;
  version: number;
  effective_on: string | null;
  config: ScoringRule;
  notes: string | null;
}
interface Settings {
  today: string;
  currentId: string;
  current: ScoringRule;
  defaults: ScoringRule;
  latestVersion: number;
  versions: Version[];
}
export function ScoringSettingsPage() {
  const { me } = useSession();
  const [data, setData] = useState<Settings | null>(null),
    [config, setConfig] = useState<ScoringRule>(defaultRule());
  const [date, setDate] = useState(""),
    [notes, setNotes] = useState(""),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const [newId, setNewId] = useState(""),
    [newLabel, setNewLabel] = useState("");
  const [activity, setActivity] = useState("running"),
    [intensity, setIntensity] = useState("moderate"),
    [minutes, setMinutes] = useState(30);
  const [preview, setPreview] = useState<{
      points: number;
      gross: number;
      signature: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const admin = me?.membership.role === "admin";
  async function load() {
    const body = await api<Settings>("/api/scoring-settings");
    setData(body);
    setDate(body.today);
    // Start with the requested fitness rates, retaining any historical custom identifiers.
    setConfig({
      ...body.defaults,
      types: { ...body.current.types, ...body.defaults.types },
    });
  }
  useEffect(() => {
    if (admin)
      void load().catch((e) =>
        setError(
          e instanceof ApiError
            ? e.message
            : "Could not load scoring settings.",
        ),
      );
  }, [admin]);
  function changeType(id: string, patch: Partial<TypeRule>) {
    setConfig((c) => ({
      ...c,
      types: { ...c.types, [id]: { ...c.types[id]!, ...patch } },
    }));
  }
  async function calculate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pointsTenths: number; grossPointsTenths: number }>(
        "/api/scoring-settings/preview",
        {
          method: "POST",
          body: JSON.stringify({
            config,
            type: activity,
            intensity,
            durationMin: minutes,
          }),
        },
      );
      setPreview({
        points: r.pointsTenths,
        gross: r.grossPointsTenths,
        signature: JSON.stringify(config),
      });
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not preview these settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function publish(e: FormEvent) {
    e.preventDefault();
    if (!data || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api("/api/scoring-settings", {
        method: "POST",
        body: JSON.stringify({
          config,
          effectiveOn: date,
          notes,
          expectedVersion: data.latestVersion,
        }),
      });
      const body = await api<Settings>("/api/scoring-settings");
      setData(body);
      setPreview(null);
      setMessage(
        "Scoring version published. Existing workout awards stay unchanged.",
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not publish settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!admin)
    return (
      <main className="px-s2 py-s4">
        <h1>Scoring Settings</h1>
        <p>Only administrators can manage scoring.</p>
      </main>
    );
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Scoring Settings</h1>
      <p className="text-sm text-quiet">
        Changes create a new version for workouts on or after the effective
        date. Existing awards stay unchanged; edits use their original scoring
        version. Rest and recovery matter.
      </p>
      {error ? (
        <p role="alert" className="error-banner">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {!data ? (
        <p role="status">Loading settings…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-s1">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setConfig(data.current);
                setPreview(null);
              }}
            >
              Load current rules
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setConfig({
                  ...data.defaults,
                  types: { ...data.current.types, ...data.defaults.types },
                });
                setPreview(null);
              }}
            >
              Use fitness defaults
            </button>
          </div>
          <form onSubmit={publish} className="flex flex-col gap-s3">
            <section className="panel">
              <h2 className="font-heading font-semibold">Activities</h2>
              <p className="text-xs text-quiet">
                Rename labels or disable activities. Existing identifiers are
                retained for history.
              </p>
              {Object.entries(config.types).map(([id, t]) => (
                <fieldset
                  key={id}
                  className="flex min-w-0 flex-col gap-s1 border-b border-line pb-s2"
                >
                  <legend className="font-heading font-semibold">
                    {t.label ?? id.replaceAll("_", " ")}
                  </legend>
                  <label className="field">
                    Activity name
                    <input
                      aria-label={`Name for ${id}`}
                      maxLength={60}
                      required
                      value={t.label ?? id.replaceAll("_", " ")}
                      onChange={(e) =>
                        changeType(id, { label: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Points per 10 minutes
                    <input
                      aria-label={`Points per 10 minutes for ${id}`}
                      type="number"
                      min="0.1"
                      max="100"
                      step="0.1"
                      required
                      value={t.multiplierHundredths / 100}
                      onChange={(e) =>
                        changeType(id, {
                          multiplierHundredths: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-s1">
                    <input
                      type="checkbox"
                      checked={t.enabled !== false}
                      onChange={(e) =>
                        changeType(id, { enabled: e.target.checked })
                      }
                    />
                    Enabled for new workouts
                  </label>
                  <div className="flex flex-wrap gap-s2">
                    {FITNESS_CATEGORIES.map((category) => (
                      <label
                        key={category}
                        className="flex items-center gap-s1 capitalize"
                      >
                        <input
                          aria-label={`${category} for ${id}`}
                          type="checkbox"
                          checked={t.categories?.includes(category) ?? false}
                          onChange={(e) =>
                            changeType(id, {
                              categories: e.target.checked
                                ? [...(t.categories ?? []), category]
                                : (t.categories ?? []).filter(
                                    (c) => c !== category,
                                  ),
                            })
                          }
                        />
                        {category}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div className="flex flex-col gap-s1">
                <label className="field">
                  New activity identifier
                  <input
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder="e.g. cycling"
                  />
                </label>
                <label className="field">
                  New activity name
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (
                      !/^[a-z][a-z0-9_]{0,39}$/.test(newId) ||
                      Object.hasOwn(config.types, newId) ||
                      ["constructor", "prototype", "__proto__"].includes(newId)
                    ) {
                      setError(
                        "Use a new identifier with lowercase letters, numbers, or underscores.",
                      );
                      return;
                    }
                    changeType(newId, {
                      label: newLabel,
                      multiplierHundredths: 800,
                      enabled: true,
                      categories: ["endurance"],
                      allowsDistance: false,
                      maxDistanceM: null,
                      minPaceSecPerKm: null,
                      minSplitSecPer500: null,
                    });
                    setNewId("");
                    setNewLabel("");
                  }}
                >
                  Add activity
                </button>
              </div>
            </section>
            <section className="panel">
              <h2 className="font-heading font-semibold">
                Intensity multipliers
              </h2>
              {INTENSITIES.map((i) => (
                <label key={i} className="field capitalize">
                  {i === "max" ? "Maximum" : i}
                  <input
                    aria-label={`${i} multiplier`}
                    type="number"
                    min="0.01"
                    max="2"
                    step="0.01"
                    value={config.intensityHundredths[i] / 100}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        intensityHundredths: {
                          ...config.intensityHundredths,
                          [i]: Math.round(Number(e.target.value) * 100),
                        },
                      })
                    }
                  />
                </label>
              ))}
              <p className="text-xs text-quiet">
                Consistency rewards do not depend on intensity. Avoid repeated
                maximum-intensity sessions.
              </p>
            </section>
            <section className="panel">
              <h2 className="font-heading font-semibold">Point caps</h2>
              {(
                [
                  ["Workout cap", "sessionCapTenths"],
                  ["Daily cap", "dailyCapTenths"],
                ] as const
              ).map(([label, key]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    type="number"
                    min="0.1"
                    max="1000"
                    step="0.1"
                    value={config[key] / 10}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        [key]: Math.round(Number(e.target.value) * 10),
                      })
                    }
                  />
                </label>
              ))}
            </section>
            <section className="panel">
              <h2 className="font-heading font-semibold">Weekly consistency</h2>
              <p className="text-sm text-quiet">
                Only the highest bonus applies. No extra reward after five days.
                Easy recovery sessions count; take rest days. Weekly settings
                are fixed at the start of each week.
              </p>
              <label className="field">
                Minimum total minutes per training day
                <input
                  type="number"
                  min="10"
                  max="60"
                  value={config.consistencyMinMinutes ?? 20}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      consistencyMinMinutes: Number(e.target.value),
                    })
                  }
                />
              </label>
              {(config.consistency ?? []).map((tier, index) => (
                <div key={index} className="grid grid-cols-2 gap-s1">
                  <label className="field">
                    Training days
                    <input
                      aria-label={`Days for bonus ${index + 1}`}
                      type="number"
                      min="2"
                      max="5"
                      value={tier.days}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          consistency: config.consistency!.map((t, i) =>
                            i === index
                              ? { ...t, days: Number(e.target.value) }
                              : t,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Total weekly bonus
                    <input
                      aria-label={`Points for bonus ${index + 1}`}
                      type="number"
                      min="0"
                      max="20"
                      step="0.1"
                      value={tier.pointsTenths / 10}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          consistency: config.consistency!.map((t, i) =>
                            i === index
                              ? {
                                  ...t,
                                  pointsTenths: Math.round(
                                    Number(e.target.value) * 10,
                                  ),
                                }
                              : t,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfig({ ...config, consistency: [] })}
              >
                Disable weekly bonuses
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setConfig({
                    ...config,
                    consistency: defaultRule().consistency,
                    consistencyMinMinutes: 20,
                  })
                }
              >
                Restore suggested bonuses
              </button>
            </section>
            <section className="panel">
              <h2 className="font-heading font-semibold">
                Preview before publishing
              </h2>
              <label className="field">
                Preview activity
                <select
                  value={activity}
                  onChange={(e) => setActivity(e.target.value)}
                >
                  {Object.entries(config.types)
                    .filter(([, t]) => t.enabled !== false)
                    .map(([id, t]) => (
                      <option key={id} value={id}>
                        {t.label ?? id}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Preview minutes
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              <label className="field">
                Preview intensity
                <select
                  value={intensity}
                  onChange={(e) => setIntensity(e.target.value)}
                >
                  {INTENSITIES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy}
                className="secondary-button"
                onClick={() => void calculate()}
              >
                Calculate preview
              </button>
              {preview ? (
                <p role="status">
                  Preview: {formatPoints(preview.points)} points (
                  {formatPoints(preview.gross)} before caps). Before other
                  workouts, training limits, and weekly bonuses.
                </p>
              ) : null}
              <label className="field">
                Effective date
                <input
                  type="date"
                  required
                  min={data.today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="field">
                Reason or notes
                <input
                  maxLength={200}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={busy || preview?.signature !== JSON.stringify(config)}
                className="save-workout"
              >
                Publish scoring version
              </button>
            </section>
          </form>
          <section className="panel">
            <h2 className="font-heading font-semibold">
              Previous scoring versions
            </h2>
            {data.versions.map((v) => (
              <details key={v.id}>
                <summary>
                  Version {v.version} · {v.effective_on ?? "Original"}
                  {v.id === data.currentId ? " · Current" : ""}
                </summary>
                <p>
                  Workout cap {formatPoints(v.config.sessionCapTenths)} · Daily
                  cap {formatPoints(v.config.dailyCapTenths)}
                </p>
                <p>{v.notes}</p>
                <ul>
                  {Object.entries(v.config.types).map(([id, t]) => (
                    <li key={id}>
                      {t.label ?? id.replaceAll("_", " ")}:{" "}
                      {t.multiplierHundredths / 100} points / 10 min
                      {t.enabled === false ? " · Disabled" : ""}
                    </li>
                  ))}
                </ul>
                <p>
                  Intensity:{" "}
                  {INTENSITIES.map(
                    (i) => `${i} ${v.config.intensityHundredths[i] / 100}×`,
                  ).join(", ")}
                </p>
                <p>
                  Weekly bonuses:{" "}
                  {(v.config.consistency ?? [])
                    .map(
                      (t) =>
                        `${t.days} days: ${formatPoints(t.pointsTenths)} pts`,
                    )
                    .join(", ") || "None"}
                </p>
              </details>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
