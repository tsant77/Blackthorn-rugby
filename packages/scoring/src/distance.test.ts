import { describe, expect, it } from "vitest";
import { metersToMiles, milesToMeters } from "./distance";

describe("miles and meters", () => {
  it("converts a mile to 1609 meters and back to 1.00", () => {
    expect(milesToMeters(1)).toBe(1609);
    expect(metersToMiles(1609)).toBe(1);
    expect(metersToMiles(milesToMeters(3.1))).toBe(3.1);
  });
});
