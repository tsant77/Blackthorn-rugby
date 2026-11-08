import { useEffect, useState } from "react";
import { formatPoints } from "@blackthorn/scoring";
import { api } from "../api";
interface Entry {
  id: string;
  kind: string;
  points_tenths: number;
  reason_code: string;
  reason_detail: string | null;
  version: number;
  actor_name: string | null;
  occurred_on: string | null;
  workout_date: string | null;
}
export function ScoringHistory() {
  const [history, setHistory] = useState<Entry[]>([]),
    [error, setError] = useState(false);
  useEffect(() => {
    void api<{ history: Entry[] }>("/api/scoring-history")
      .then((b) => setHistory(b.history))
      .catch(() => setError(true));
  }, []);
  return (
    <section className="panel">
      <h2 className="font-heading font-semibold">Scoring history</h2>
      <p className="text-xs text-quiet">
        Latest 100 ledger entries. Corrections and bonuses appear separately;
        original entries remain.
      </p>
      {error ? (
        <p role="alert">Could not load scoring history.</p>
      ) : (
        <ul className="flex flex-col gap-s1">
          {history.map((r) => (
            <li key={r.id} className="text-sm break-words">
              {formatPoints(r.points_tenths)} pts ·{" "}
              {r.reason_code.replaceAll("_", " ")} · v{r.version} ·{" "}
              {r.occurred_on ?? r.workout_date}
              <br />
              {r.reason_detail}
              {r.kind === "adjustment" && r.reason_code !== "weekly_consistency"
                ? ` · Adjustment by ${r.actor_name ?? "administrator"}`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
