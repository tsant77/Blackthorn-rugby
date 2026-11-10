export function isRealCivilDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addDays(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    throw new Error(`Not a civil date: ${iso}`);
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Reuse immutable formatters across requests; bound the cache for arbitrary club time zones.
const civilFormatters = new Map<string, Intl.DateTimeFormat>();

export function civilDateInTimeZone(instant: Date, timeZone: string): string {
  let formatter = civilFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (civilFormatters.size >= 16) civilFormatters.delete(civilFormatters.keys().next().value!);
    civilFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Could not format civil date for ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}

export function compareCivil(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
