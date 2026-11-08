import { describe, expect, it } from "vitest";
import { challengeStandings, isComplete, type ProgressRow } from "./challenge-math";

const rows: ProgressRow[] = [
  { profileId: "a", rosterName: "Prop", groupId: "group_forwards", groupName: "Forwards", minutes: 40, meters: 0, sessions: 1, pointsTenths: 60 },
  { profileId: "b", rosterName: "Wing", groupId: "group_backs", groupName: "Backs", minutes: 20, meters: 1609, sessions: 1, pointsTenths: 30 },
];

describe("challenge progress", () => {
  it("marks an individual target from sessions and points", () => {
    expect(isComplete("sessions", 1, 1)).toBe(true);
    expect(isComplete("points", 60, 10)).toBe(false);
    const result = challengeStandings({ scope: "individual", metric: "sessions", target: 1, groupId: null }, rows);
    expect(result.leaders.every((row) => row.complete)).toBe(true);
    expect(result.summary).toContain("Prop");
  });

  it("compares forwards and backs on minutes", () => {
    const result = challengeStandings({ scope: "group", metric: "minutes", target: 30, groupId: null }, rows);
    expect(result.sides.map((side) => side.name)).toEqual(["Forwards", "Backs"]);
    expect(result.sides[0]?.complete).toBe(true);
    expect(result.sides[1]?.complete).toBe(false);
    expect(result.summary).toContain("Forwards lead");
  });

  it("treats one stored mile as a completed mile target", () => {
    expect(isComplete("miles", 1609, 1)).toBe(true);
  });
});
