import { addDays } from "./dates";
import { describe, expect, it } from "vitest";
import { legacyRule as defaultRule } from "./defaults";
import { formatPoints, planReversal, scoreWorkout } from "./engine";
import { assertClientCannotSetPoints, ClientPointsError } from "./index";
import type { PriorWorkout, ScoreInput, ScoringRule, WorkoutDraft } from "./types";

const NOW = new Date("2026-11-08T15:00:00.000Z");
const ZONE = "America/New_York";

function workout(overrides: Partial<WorkoutDraft> = {}): WorkoutDraft {
  return {
    type: "running",
    occurredOn: "2026-11-08",
    durationMin: 40,
    intensity: "moderate",
    ...overrides,
  };
}

function score(overrides: Partial<ScoreInput> = {}, workoutOverrides: Partial<WorkoutDraft> = {}) {
  const input: ScoreInput = {
    workout: workout(workoutOverrides),
    athlete: { injuryStatus: "available", trainingLocked: false },
    rule: defaultRule(),
    history: [],
    now: NOW,
    timeZone: ZONE,
    offseasonStart: null,
    offseasonEnd: null,
    ...overrides,
  };
  if (overrides.workout) input.workout = overrides.workout;
  return scoreWorkout(input);
}

function prior(overrides: Partial<PriorWorkout>): PriorWorkout {
  return {
    id: "prior-1",
    type: "running",
    occurredOn: "2026-11-08",
    startedAt: null,
    endedAt: null,
    durationMin: 40,
    intensity: "moderate",
    status: "approved",
    clientRequestId: null,
    awardedPointsTenths: 60,
    ...overrides,
  };
}

function net(transactions: { pointsTenths: number }[]): number {
  return transactions.reduce((sum, row) => sum + row.pointsTenths, 0);
}

describe("default formula", () => {
  it("scores the published type multipliers at moderate intensity", () => {
    expect(score({}, { type: "running" }).awardedPointsTenths).toBe(60);
    expect(score({}, { type: "rower" }).awardedPointsTenths).toBe(60);
    expect(score({}, { type: "circuit_training" }).awardedPointsTenths).toBe(60);
    expect(score({}, { type: "weight_training" }).awardedPointsTenths).toBe(50);
    expect(score({}, { type: "rugby" }).awardedPointsTenths).toBe(50);
    expect(score({}, { type: "basketball" }).awardedPointsTenths).toBe(40);
    expect(score({}, { type: "football" }).awardedPointsTenths).toBe(40);
  });

  it("treats a missing intensity as moderate", () => {
    const decision = score({}, { intensity: null });
    expect(decision.awardedPointsTenths).toBe(60);
    expect(decision.ruleVersion).toBe(1);
    expect(decision.outcome).toBe("award");
  });

  it("applies intensity without letting it skip the caps", () => {
    expect(score({}, { intensity: "easy" }).awardedPointsTenths).toBe(51);
    expect(score({}, { intensity: "hard" }).awardedPointsTenths).toBe(69);
    expect(score({}, { intensity: "max" }).awardedPointsTenths).toBe(75);
  });

  it("rounds half up to a tenth of a point", () => {
    expect(score({}, { durationMin: 1 }).awardedPointsTenths).toBe(2);
    expect(formatPoints(2)).toBe("0.2");
    expect(formatPoints(60)).toBe("6.0");
    expect(formatPoints(-15)).toBe("-1.5");
  });

  it("does not pay extra for a plausible distance", () => {
    const withDistance = score({}, { distanceM: 8_000 });
    const withoutDistance = score();
    expect(withDistance.awardedPointsTenths).toBe(withoutDistance.awardedPointsTenths);
  });
});

describe("caps", () => {
  it("applies the session cap and records the reduction", () => {
    const decision = score({}, { durationMin: 240 });
    expect(decision.grossPointsTenths).toBe(360);
    expect(decision.awardedPointsTenths).toBe(150);
    expect(decision.flags).toContain("session_cap");
    expect(net(decision.transactions)).toBe(150);
    expect(decision.transactions.map((row) => row.reasonCode)).toEqual(["formula", "session_cap"]);
  });

  it("applies the daily cap against points already awarded today", () => {
    const decision = score({
      history: [prior({ awardedPointsTenths: 280, durationMin: 30 })],
    });
    expect(decision.awardedPointsTenths).toBe(20);
    expect(decision.flags).toContain("daily_cap");
    expect(net(decision.transactions)).toBe(20);
  });

  it("awards zero once the daily cap is already met", () => {
    const decision = score({
      history: [prior({ awardedPointsTenths: 300, durationMin: 200 })],
    });
    expect(decision.outcome).toBe("award");
    expect(decision.awardedPointsTenths).toBe(0);
    expect(net(decision.transactions)).toBe(0);
  });

  it("ignores rejected and voided sessions when applying the daily cap", () => {
    const decision = score({
      history: [
        prior({ id: "r", status: "rejected", awardedPointsTenths: 300 }),
        prior({ id: "v", status: "voided", awardedPointsTenths: 300 }),
      ],
    });
    expect(decision.awardedPointsTenths).toBe(60);
  });

  it("stacks the session cap and the daily cap in the ledger", () => {
    const decision = score(
      { history: [prior({ awardedPointsTenths: 260, durationMin: 20 })] },
      { durationMin: 240 },
    );
    expect(decision.grossPointsTenths).toBe(360);
    expect(decision.awardedPointsTenths).toBe(40);
    expect(decision.flags).toEqual(["session_cap", "daily_cap"]);
    expect(net(decision.transactions)).toBe(40);
  });
});

describe("calendar", () => {
  it("rejects a future civil date and an 8-day-old date", () => {
    expect(score({}, { occurredOn: "2026-11-09" }).rejectCode).toBe("future_date");
    expect(score({}, { occurredOn: "2026-11-01" }).outcome).toBe("award");
    expect(score({}, { occurredOn: "2026-10-31" }).rejectCode).toBe("outside_backdate_window");
  });

  it("uses America/New_York, not UTC, for today", () => {
    const lateUtc = score({ now: new Date("2026-11-08T03:30:00.000Z") }, { occurredOn: "2026-11-08" });
    const stillYesterday = score(
      { now: new Date("2026-11-08T03:30:00.000Z") },
      { occurredOn: "2026-11-07" },
    );
    expect(lateUtc.rejectCode).toBe("future_date");
    expect(stillYesterday.outcome).toBe("award");
  });

  it("rejects dates outside the offseason window passed by the caller", () => {
    const decision = score(
      { offseasonStart: "2026-11-08", offseasonEnd: "2026-12-31" },
      { occurredOn: "2026-11-07" },
    );
    expect(decision.rejectCode).toBe("outside_offseason");
  });

  it("rejects a start time that falls on a different civil date", () => {
    const decision = score({}, {
      startedAt: "2026-11-07T15:00:00.000Z",
      endedAt: "2026-11-07T15:40:00.000Z",
    });
    expect(decision.rejectCode).toBe("date_time_mismatch");
  });
});

describe("injury and overtraining", () => {
  it("scores nothing while the athlete is out or locked", () => {
    expect(score({ athlete: { injuryStatus: "out", trainingLocked: false } }).rejectCode).toBe("injury_hold");
    expect(
      score({ athlete: { injuryStatus: "available", trainingLocked: true } }).transactions,
    ).toEqual([]);
  });

  it("only scores easy sessions of cleared types while limited", () => {
    const rule = defaultRule();
    rule.allowedWhenLimited = ["running"];
    const athlete = { injuryStatus: "limited" as const, trainingLocked: false };
    expect(score({ athlete, rule }, { type: "rugby", intensity: "easy" }).rejectCode).toBe(
      "limited_type_blocked",
    );
    expect(score({ athlete, rule }, { intensity: "moderate" }).rejectCode).toBe(
      "limited_intensity_blocked",
    );
    expect(score({ athlete, rule }, { intensity: "easy" }).outcome).toBe("award");
  });

  it("rejects the session that would push any 7-day window over the load limit", () => {
    const history = [
      prior({ id: "a", occurredOn: "2026-11-06", durationMin: 240, awardedPointsTenths: 150 }),
      prior({ id: "b", occurredOn: "2026-11-07", durationMin: 240, awardedPointsTenths: 150 }),
    ];
    expect(score({ history }, { durationMin: 120 }).outcome).toBe("award");
    expect(score({ history }, { durationMin: 121 }).rejectCode).toBe("overtraining_guard");
  });

  it("weights max-intensity minutes more heavily and ignores rejected history", () => {
    const heavy = prior({
      id: "max",
      occurredOn: "2026-11-07",
      durationMin: 240,
      intensity: "max",
      awardedPointsTenths: 150,
    });
    expect(score({ history: [heavy] }, { durationMin: 160, intensity: "max" }).outcome).toBe("award");
    expect(score({ history: [heavy] }, { durationMin: 161, intensity: "max" }).rejectCode).toBe(
      "overtraining_guard",
    );
    const rejected = prior({ ...heavy, status: "rejected" });
    expect(score({ history: [rejected] }, { durationMin: 240, intensity: "max" }).outcome).toBe("award");
  });

  it("counts a later logged session when a backdated workout would overload that week", () => {
    const later = prior({
      id: "later",
      occurredOn: "2026-11-08",
      durationMin: 240,
      intensity: "max",
      awardedPointsTenths: 150,
    });
    const decision = score(
      { history: [later] },
      { occurredOn: "2026-11-05", durationMin: 240, intensity: "max" },
    );
    expect(decision.rejectCode).toBe("overtraining_guard");
  });
});

describe("duplicates, overlaps, and abuse", () => {
  it("returns the original session for a repeated client request id", () => {
    const decision = score({
      history: [prior({ clientRequestId: "request-1234", status: "rejected" })],
      workout: workout({ clientRequestId: "request-1234", occurredOn: "2026-11-09" }),
    });
    expect(decision.outcome).toBe("duplicate");
    expect(decision.matchedWorkoutId).toBe("prior-1");
    expect(decision.transactions).toEqual([]);
  });

  it("allows the same client request id after the original was voided", () => {
    const decision = score({
      history: [prior({ clientRequestId: "request-1234", status: "voided" })],
      workout: workout({ clientRequestId: "request-1234" }),
    });
    expect(decision.outcome).toBe("award");
  });

  it("counts identical and overlapping same-day sessions, and lets the daily cap bind", () => {
    const identical = score({ history: [prior({ durationMin: 40, awardedPointsTenths: 60 })] }, { durationMin: 40 });
    expect(identical.outcome).toBe("award");
    expect(identical.awardedPointsTenths).toBe(60);

    const overlap = score(
      {
        history: [prior({
          durationMin: 40,
          awardedPointsTenths: 60,
          startedAt: "2026-11-08T15:00:00.000Z",
          endedAt: "2026-11-08T15:40:00.000Z",
        })],
      },
      {
        durationMin: 30,
        startedAt: "2026-11-08T15:20:00.000Z",
        endedAt: "2026-11-08T15:50:00.000Z",
      },
    );
    expect(overlap.outcome).toBe("award");
    expect(overlap.awardedPointsTenths).toBe(45);

    const capped = score({ history: [prior({ durationMin: 40, awardedPointsTenths: 300 })] }, { durationMin: 40 });
    expect(capped.awardedPointsTenths).toBe(0);
    expect(capped.flags).toContain("daily_cap");
  });

  it("counts a session being edited again when the caller leaves it in history", () => {
    const decision = score({
      history: [prior({ durationMin: 40, awardedPointsTenths: 280 })],
    }, { durationMin: 40 });
    expect(decision.outcome).toBe("award");
    expect(decision.awardedPointsTenths).toBe(20);
  });

  it("rejects implausible pace, split, and load", () => {
    expect(score({}, { distanceM: 16_001 }).rejectCode).toBe("implausible_pace");
    expect(score({}, { distanceM: 16_000 }).outcome).toBe("award");
    expect(score({}, { type: "rower", distanceM: 15_001 }).rejectCode).toBe("implausible_split");
    expect(score({}, { type: "rower", distanceM: 15_000 }).outcome).toBe("award");
    const heavy = score({}, {
      type: "weight_training",
      exercises: [{ name: "Back squat", sets: 3, reps: 5, loadGrams: 400_001 }],
    });
    expect(heavy.rejectCode).toBe("implausible_load");
    const legal = score({}, {
      type: "weight_training",
      exercises: [{ name: "Back squat", sets: 3, reps: 5, loadGrams: 400_000 }],
    });
    expect(legal.outcome).toBe("award");
  });

  it("rejects malformed measurements and client-supplied points", () => {
    expect(score({}, { type: "football", distanceM: 100 }).rejectCode).toBe("invalid_distance");
    expect(score({}, { durationMin: 0 }).rejectCode).toBe("invalid_duration");
    expect(score({}, { durationMin: 241 }).rejectCode).toBe("invalid_duration");
    expect(score({}, { type: "cycling" }).rejectCode).toBe("invalid_type");
    expect(score({}, { occurredOn: "2026-02-31" }).rejectCode).toBe("invalid_date");
    expect(score({}, { notes: "x".repeat(501) }).rejectCode).toBe("invalid_notes");
    expect(
      score({}, {
        startedAt: "2026-11-08T15:00:00.000Z",
        endedAt: "2026-11-08T17:00:00.000Z",
      }).rejectCode,
    ).toBe("duration_mismatch");

    expect(() => assertClientCannotSetPoints({ points: 99 })).toThrow(ClientPointsError);
    expect(() => assertClientCannotSetPoints({ exercises: [{ name: "Squat", awardedPoints: 4 }] })).toThrow(
      ClientPointsError,
    );
    expect(() => assertClientCannotSetPoints({ type: "running", notes: "felt like a 10" })).not.toThrow();
  });

  it("refuses a draft or oversized rule even when the workout is otherwise legal", () => {
    const draft = defaultRule();
    draft.status = "draft";
    expect(score({ rule: draft }, { occurredOn: "2026-11-09" }).rejectCode).toBe("rule_not_active");

    const oversized = defaultRule();
    oversized.sessionCapTenths = 400;
    expect(score({ rule: oversized }).rejectCode).toBe("invalid_rule");
  });

  it("plans an exact reversal of a net award", () => {
    const reversal = planReversal(60);
    expect(reversal.pointsTenths).toBe(-60);
    expect(60 + reversal.pointsTenths).toBe(0);
  });
});

describe("published defaults", () => {
  it("matches the scoring specification", () => {
    const rule: ScoringRule = defaultRule();
    expect(rule.types.running?.multiplierHundredths).toBe(150);
    expect(rule.types.weight_training?.multiplierHundredths).toBe(125);
    expect(rule.types.basketball?.multiplierHundredths).toBe(100);
    expect(rule.dailyCapTenths).toBe(300);
    expect(rule.sessionCapTenths).toBe(150);
    expect(rule.weeklyLoadLimit).toBe(600);
    expect(rule.backdateDays).toBe(7);
    expect(rule.allowedWhenLimited).toEqual([]);
  });
});


describe("rolling training-load equivalence", () => {
  it("matches exhaustive seven-day windows with individual rounding and excluded statuses", () => {
    let seed = 7183;
    const random = (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
    const intensities = ["easy", "moderate", "hard", "max"] as const;
    const statuses = ["submitted", "approved", "voided", "rejected"] as const;
    for (let sample = 0; sample < 100; sample++) {
      const rule = defaultRule();
      const history = Array.from({ length: 40 }, (_, i) => prior({ id: String(i), occurredOn: addDays("2026-11-08", random(19) - 9),
        durationMin: random(31) + 1, intensity: intensities[random(4)]!, status: statuses[random(4)]! }));
      const draft = workout({ durationMin: random(31) + 1, intensity: intensities[random(4)]! });
      const counted = history.filter(w => w.status === "submitted" || w.status === "approved");
      const loads = [...counted, draft].map(w => ({ date: w.occurredOn, load: Math.floor((w.durationMin * rule.intensityLoadHundredths[w.intensity ?? "moderate"] + 50) / 100) }));
      const maximum = Math.max(...Array.from({ length: 7 }, (_, i) => {
        const start = addDays(draft.occurredOn, i - 6), end = addDays(start, 6);
        return loads.filter(w => w.date >= start && w.date <= end).reduce((total, w) => total + w.load, 0);
      }));
      for (const delta of [-1, 0, 1]) {
        rule.weeklyLoadLimit = Math.max(1, maximum + delta);
        const result = score({ history, rule }, draft);
        expect(result.rejectCode === "overtraining_guard").toBe(maximum > rule.weeklyLoadLimit);
      }
    }
  });
});
