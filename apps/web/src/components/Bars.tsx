import { formatPoints } from "@blackthorn/scoring";

export function Bars({ caption, rows }: { caption: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <figure>
      <figcaption className="font-heading font-semibold">{caption}</figcaption>
      <ul className="mt-s2 flex h-s8 items-end gap-half" aria-hidden="true">
        {rows.map((row) => (
          <li key={row.label} className="flex-1 rounded-sm bg-pitch" style={{ height: `${Math.max(8, (row.value / max) * 100)}%` }} />
        ))}
      </ul>
      <table className="mt-s2 w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-quiet">
            <th scope="col" className="py-half font-normal">Period</th>
            <th scope="col" className="py-half text-right font-normal">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-line">
              <th scope="row" className="py-half font-normal">{row.label}</th>
              <td className="py-half text-right">{formatPoints(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
