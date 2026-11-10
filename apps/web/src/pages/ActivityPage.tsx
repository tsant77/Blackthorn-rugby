import { useEffect, useState } from "react";
import { formatPoints } from "@blackthorn/scoring";
import { api, ApiError } from "../api";

interface Item {
  id: string;
  type: string;
  occurred_on: string;
  duration_min: number;
  roster_name: string;
  points_tenths: number;
}

export function ActivityPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ activity: Item[] }>("/api/activity").then((body) => setItems(body.activity)).catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : "Could not load activity.");
    });
  }, []);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Team activity</h1>
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      {items.length === 0 ? <p className="text-quiet">No sessions yet.</p> : null}
      <ul className="flex flex-col gap-s1">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border border-line bg-raised px-s2 py-s1">
            <p className="font-heading font-semibold">{item.roster_name}</p>
            <p className="text-sm text-quiet">{item.type.replaceAll("_", " ")} · {item.occurred_on} · {item.duration_min} min · {formatPoints(item.points_tenths)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
