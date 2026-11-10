const civil = (value: string) => new Date(value + "T12:00:00Z");
export function displayDate(value: string): string {
  const date = civil(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
export function displayRange(start: string, end: string): string {
  const a = civil(start), b = civil(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).formatRange(a, b);
}
