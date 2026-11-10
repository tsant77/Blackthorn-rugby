import { describe, expect, it } from "vitest";
import { earnedKeys, streakDays, type BadgeDefinition } from "./awards";

const definitions: BadgeDefinition[] = [
  { key: "first_session", criteria: { kind: "sessions", count: 1 } },
  { key: "streak_3", criteria: { kind: "streak", days: 3 } },
  { key: "points_50", criteria: { kind: "points", tenths: 500 } },
  { key: "variety_3", criteria: { kind: "variety", types: 3 } },
];

describe("badge awards", () => {
  it("counts a streak through today, or through yesterday when today is empty", () => {
    expect(streakDays(["2026-11-06", "2026-11-07", "2026-11-08"], "2026-11-08")).toBe(3);
    expect(streakDays(["2026-11-06", "2026-11-07"], "2026-11-08")).toBe(2);
    expect(streakDays(["2026-11-06"], "2026-11-08")).toBe(0);
  });

  it("awards each badge once the stat is met and ignores the ones that are not", () => {
    const keys = earnedKeys(definitions, { sessionCount: 1, streakDays: 3, pointsTenths: 499, activityTypes: 2 });
    expect(keys).toEqual(["first_session", "streak_3"]);
    expect(earnedKeys(definitions, { sessionCount: 4, streakDays: 7, pointsTenths: 500, activityTypes: 3 })).toEqual([
      "first_session",
      "streak_3",
      "points_50",
      "variety_3",
    ]);
  });
});
