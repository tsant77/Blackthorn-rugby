/** International mile. Stored workout distances stay in meters. */
export const METERS_PER_MILE = 1609.344;

export function milesToMeters(miles: number): number {
  if (!Number.isFinite(miles)) {
    throw new Error("Miles must be a finite number.");
  }
  return Math.round(miles * METERS_PER_MILE);
}

/** Two decimal miles for display. */
export function metersToMiles(meters: number): number {
  if (!Number.isFinite(meters)) {
    throw new Error("Meters must be a finite number.");
  }
  return Math.round((meters / METERS_PER_MILE) * 100) / 100;
}
