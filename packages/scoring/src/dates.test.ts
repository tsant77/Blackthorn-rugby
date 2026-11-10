import { describe, expect, it } from "vitest";
import { civilDateInTimeZone } from "./dates";

describe("club-local dates across repeated requests", () => {
  it("keeps time zones separate and follows daylight saving transitions", () => {
    for (let i = 0; i < 3; i++) {
      expect(civilDateInTimeZone(new Date("2026-03-08T04:30:00Z"), "America/New_York")).toBe("2026-03-07");
      expect(civilDateInTimeZone(new Date("2026-03-08T04:30:00Z"), "Europe/London")).toBe("2026-03-08");
      expect(civilDateInTimeZone(new Date("2026-03-09T04:30:00Z"), "America/New_York")).toBe("2026-03-09");
      expect(civilDateInTimeZone(new Date("2026-11-02T04:30:00Z"), "America/New_York")).toBe("2026-11-01");
    }
  });

  it("rejects invalid time zones without affecting later requests", () => {
    const instant = new Date("2026-11-08T02:00:00Z");
    expect(() => civilDateInTimeZone(instant, "Invalid/Zone")).toThrow(RangeError);
    expect(civilDateInTimeZone(instant, "America/New_York")).toBe("2026-11-07");
  });
});
