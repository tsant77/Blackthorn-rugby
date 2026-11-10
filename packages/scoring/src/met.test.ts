import { describe, expect, it } from "vitest";
import { defaultRule, metRule, workoutFormulaTenths, validateRule } from "./index";

describe("MET game scoring",()=>{
  it("uses the reference MET and intensity factor with one final rounding",()=>{
    const rule=metRule(defaultRule());
    expect(validateRule(rule)).toBeNull();
    expect(workoutFormulaTenths(rule,"weight_training",60,"moderate")).toBe(350);
    expect(workoutFormulaTenths(rule,"weight_training",60,"hard")).toBe(438);
    expect(workoutFormulaTenths(rule,"running",30,"moderate")).toBe(400);
    expect(workoutFormulaTenths(rule,"cycling",30,"moderate")).toBe(350);
    expect(workoutFormulaTenths(rule,"rower",30,"moderate")).toBe(250);
    expect(rule.types.cycling?.allowsDistance).toBe(true);
  });
  it("rejects missing/invalid METs and unknown activity mappings",()=>{
    const rule=metRule(defaultRule());delete rule.types.running!.metHundredths;
    expect(validateRule(rule)).toContain("MET");
    const custom=defaultRule();custom.types.custom={...custom.types.running!};
    expect(()=>metRule(custom)).toThrow("No MET reference");
  });
});
