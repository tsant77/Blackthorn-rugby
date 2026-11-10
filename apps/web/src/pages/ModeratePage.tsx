import { useEffect, useState } from "react";
import { formatPoints } from "@blackthorn/scoring";
import { api, ApiError } from "../api";

interface Item {
  id: string;
  roster_name: string;
  type: string;
  occurred_on: string;
  duration_min: number;
  status: string;
  review_note: string | null;
  points_tenths: number;
}

export function ModeratePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [reason, setReason] = useState("Not a club session");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const body = await api<{ workouts: Item[] }>("/api/moderation");
    setItems(body.workouts);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load the queue."));
  }, []);

  async function act(id: string, action: "reject" | "void" | "restore") {
    setError(null);
    try {
      await api(`/api/moderation/${id}`, { method: "POST", body: JSON.stringify({ action, reason }) });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update the workout.");
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Moderation</h1>
      <p className="text-quiet">Reject a session that is not legitimate. Void a session logged by mistake. Both remove the points.</p>
      <label className="flex flex-col gap-s1 text-sm text-quiet">
        Reason
        <input value={reason} onChange={(event) => setReason(event.target.value)} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink" />
      </label>
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      <ul className="flex flex-col gap-s2">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border border-line bg-raised p-s2">
            <p className="font-heading font-semibold">{item.roster_name}</p>
            <p className="text-sm text-quiet capitalize">{item.type.replaceAll("_", " ")} · {item.occurred_on} · {item.duration_min} min · {item.status} · {formatPoints(item.points_tenths)}</p>
            {item.review_note ? <p className="text-sm">{item.review_note}</p> : null}
            <div className="mt-s1 flex flex-wrap gap-s1">
              {item.status === "submitted" || item.status === "approved" ? (
                <>
                  <button type="button" className="rounded-md border border-line px-s2 py-s1 text-sm" onClick={() => void act(item.id, "reject")}>Reject</button>
                  <button type="button" className="rounded-md bg-danger px-s2 py-s1 text-sm text-ink" onClick={() => void act(item.id, "void")}>Void</button>
                </>
              ) : (
                <button type="button" className="rounded-md bg-gold px-s2 py-s1 text-sm font-semibold text-forest" onClick={() => void act(item.id, "restore")}>Restore</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
