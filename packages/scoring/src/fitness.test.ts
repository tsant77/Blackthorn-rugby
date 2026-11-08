import { describe, expect, it } from "vitest";
import {
  defaultRule,
  legacyRule,
  scoreWorkout,
  formulaTenths,
  validateRule,
} from "./index";
const now = new Date("2026-11-22T17:00:00Z");
function score(
  type: string,
  durationMin = 10,
  intensity: "easy" | "moderate" | "hard" | "max" = "moderate",
  rule = defaultRule(),
) {
  return scoreWorkout({
    rule,
    workout: { type, durationMin, intensity, occurredOn: "2026-11-22" },
    athlete: { injuryStatus: "available", trainingLocked: false },
    history: [],
    now,
    timeZone: "America/New_York",
    offseasonStart: null,
    offseasonEnd: null,
  });
}
describe("fitness scoring", () => {
  it.each([
    ["sprint_hiit", 12],
    ["rugby", 11],
    ["running", 10],
    ["circuit_training", 10],
    ["rower", 9],
    ["weight_training", 9],
    ["basketball", 8],
    ["football", 8],
    ["walking", 4],
  ])("scores %s at %s points per ten minutes", (type, points) => {
    expect(score(String(type)).awardedPointsTenths).toBe(Number(points) * 10);
  });
  it.each([
    ["easy", 75],
    ["moderate", 100],
    ["hard", 125],
    ["max", 140],
  ] as const)(
    "applies %s intensity without floating point drift",
    (intensity, points) =>
      expect(score("running", 10, intensity).awardedPointsTenths).toBe(points),
  );
  it("uses half-up rounding, a 60 point workout cap, and 100 point daily budget", () => {
    expect(formulaTenths(1, 900, 75)).toBe(7);
    const decision = score("sprint_hiit", 120, "max");
    expect(decision.awardedPointsTenths).toBe(600);
    expect(decision.flags).toContain("session_cap");
    expect(defaultRule().dailyCapTenths).toBe(1000);
    expect(validateRule(defaultRule())).toBeNull();
    expect(
      score("running", 40, "moderate", legacyRule()).awardedPointsTenths,
    ).toBe(60);
  });
  it("supports custom types, disables them prospectively, and validates category/settings bounds", () => {
    const rule = defaultRule();
    rule.types.cycling = {
      ...rule.types.running!,
      label: "Cycling",
      categories: ["endurance", "recovery"],
    };
    expect(score("cycling", 10, "moderate", rule).awardedPointsTenths).toBe(
      100,
    );
    rule.types.cycling!.enabled = false;
    expect(score("cycling", 10, "moderate", rule).rejectCode).toBe(
      "invalid_type",
    );
    rule.sessionCapTenths = 1001;
    expect(validateRule(rule)).toMatch(/exceed/);
    rule.sessionCapTenths = 600;
    rule.consistency = [
      { days: 3, pointsTenths: 50 },
      { days: 6, pointsTenths: 100 },
    ];
    expect(validateRule(rule)).toMatch(/Consistency/);
    rule.consistency = [];
    rule.intensityHundredths.easy = 150;
    expect(validateRule(rule)).toMatch(/ordered/);
  });
});
