export type Balance = { category: string; minutes: number }[];
export function TrainingBalance({ balance }: { balance: Balance }) {
  const total = balance.reduce((s, r) => s + r.minutes, 0);
  return (
    <section className="panel" aria-label="Training balance">
      <h2 className="font-heading font-semibold">Training balance</h2>
      <p className="text-sm text-quiet">
        Season training indicators, not clinically validated fitness
        measurements. Minutes are split equally when an activity contributes to
        multiple categories.
      </p>
      {balance.map((r) => (
        <div key={r.category} className="flex flex-col gap-s1">
          <label className="capitalize" htmlFor={`balance-${r.category}`}>
            {r.category} · {r.minutes} allocated min
          </label>
          <meter
            id={`balance-${r.category}`}
            value={r.minutes}
            max={Math.max(1, total)}
            className="w-full"
          />
        </div>
      ))}
      <p className="text-xs text-quiet">
        Recovery and rest matter. More points or repeated maximum-intensity
        sessions do not mean better fitness.
      </p>
    </section>
  );
}
