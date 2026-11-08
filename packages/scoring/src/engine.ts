import { addDays, civilDateInTimeZone, compareCivil, isRealCivilDate } from "./dates";
import type {
  Intensity,
  PointTransactionDraft,
  PriorWorkout,
  ScoreDecision,
  ScoreInput,
  ScoringRule,
  TypeRule,
  WorkoutDraft,
} from "./types";
import { INTENSITIES } from "./types";

const COUNTED = new Set(["submitted", "approved"]);
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;

/** Half-up division for non-negative integers. */
export function roundDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function formulaTenths(
  durationMin: number,
  multiplierHundredths: number,
  intensityHundredths: number,
): number {
  return roundDiv(durationMin * multiplierHundredths * intensityHundredths, 10_000);
}

export function formatPoints(tenths: number): string {
  const sign = tenths < 0 ? "-" : "";
  const absolute = Math.abs(tenths);
  const whole = Math.floor(absolute / 10);
  const fraction = absolute % 10;
  return `${sign}${whole}.${fraction}`;
}

/** Ledger row that cancels a session's net award when it is edited or voided. */
export function planReversal(netAwardedTenths: number): PointTransactionDraft {
  return {
    kind: "reversal",
    pointsTenths: -netAwardedTenths,
    reasonCode: "reversal",
  };
}

export function scoreWorkout(input: ScoreInput): ScoreDecision {
  const ruleError = validateRule(input.rule);
  if (ruleError) return reject(input, "invalid_rule", ruleError);
  if (input.rule.status !== "active") {
    return reject(input, "rule_not_active", "Scoring rule is not the active version.");
  }

  const idempotent = findIdempotent(input);
  if (idempotent) {
    return {
      outcome: "duplicate",
      ruleVersion: input.rule.version,
      grossPointsTenths: 0,
      awardedPointsTenths: 0,
      transactions: [],
      flags: ["idempotent"],
      matchedWorkoutId: idempotent.id,
      message: "This submission was already recorded.",
    };
  }

  const draftError = validateDraft(input);
  if (draftError) return reject(input, draftError.code, draftError.message);

  const calendarError = validateCalendar(input);
  if (calendarError) return reject(input, calendarError.code, calendarError.message);

  const measurementError = validateMeasurements(input);
  if (measurementError) return reject(input, measurementError.code, measurementError.message);

  const injuryError = validateInjury(input);
  if (injuryError) return reject(input, injuryError.code, injuryError.message);

  if (weeklyLoadExceeds(input)) {
    return reject(
      input,
      "overtraining_guard",
      "This session would push the week past the safe training load, so it scores nothing.",
    );
  }

  return award(input);
}

function reject(
  input: ScoreInput,
  code: ScoreDecision["rejectCode"],
  message: string,
  matchedWorkoutId?: string,
): ScoreDecision {
  const decision: ScoreDecision = {
    outcome: "reject",
    ruleVersion: integerOrZero(input.rule?.version),
    grossPointsTenths: 0,
    awardedPointsTenths: 0,
    transactions: [],
    flags: [],
    message,
  };
  if (code) decision.rejectCode = code;
  if (matchedWorkoutId) decision.matchedWorkoutId = matchedWorkoutId;
  return decision;
}

function award(input: ScoreInput): ScoreDecision {
  const draft = input.workout;
  const rule = input.rule;
  const typeRule = rule.types[draft.type] as TypeRule;
  const intensity = (draft.intensity ?? "moderate") as Intensity;
  const gross = formulaTenths(
    draft.durationMin,
    typeRule.multiplierHundredths,
    rule.intensityHundredths[intensity],
  );
  const afterSession = Math.min(gross, rule.sessionCapTenths);
  const remaining = Math.max(0, rule.dailyCapTenths - sameDayPoints(input));
  const awarded = Math.min(afterSession, remaining);

  const transactions: PointTransactionDraft[] = [
    { kind: "award", pointsTenths: gross, reasonCode: "formula" },
  ];
  const flags: string[] = [];
  if (afterSession !== gross) {
    transactions.push({
      kind: "cap_reduction",
      pointsTenths: afterSession - gross,
      reasonCode: "session_cap",
    });
    flags.push("session_cap");
  }
  if (awarded !== afterSession) {
    transactions.push({
      kind: "cap_reduction",
      pointsTenths: awarded - afterSession,
      reasonCode: "daily_cap",
    });
    flags.push("daily_cap");
  }
  if (gross === 0) flags.push("rounded_to_zero");

  return {
    outcome: "award",
    ruleVersion: rule.version,
    grossPointsTenths: gross,
    awardedPointsTenths: awarded,
    transactions,
    flags,
    message:
      awarded === gross
        ? `Awarded ${formatPoints(awarded)} points.`
        : `Awarded ${formatPoints(awarded)} of ${formatPoints(gross)} points after caps.`,
  };
}

function validateRule(rule: ScoringRule | undefined): string | null {
  if (!rule || typeof rule !== "object") return "Scoring rule is missing.";
  if (!Number.isInteger(rule.version) || rule.version < 1) return "Scoring rule version is invalid.";
  if (rule.status !== "draft" && rule.status !== "active" && rule.status !== "retired") {
    return "Scoring rule status is invalid.";
  }
  if (!inRange(rule.dailyCapTenths, 1, 1_000)) return "Daily cap is outside the allowed range.";
  if (!inRange(rule.sessionCapTenths, 1, 1_000)) return "Session cap is outside the allowed range.";
  if (rule.sessionCapTenths > rule.dailyCapTenths) return "Session cap cannot exceed the daily cap.";
  if (!inRange(rule.backdateDays, 0, 14)) return "Backdate window is outside the allowed range.";
  if (!inRange(rule.minDurationMin, 1, 240) || !inRange(rule.maxDurationMin, 1, 240)) {
    return "Duration bounds are outside the allowed range.";
  }
  if (rule.minDurationMin > rule.maxDurationMin) return "Duration bounds are inverted.";
  if (!inRange(rule.weeklyLoadLimit, 1, 2_000)) return "Weekly load limit is outside the allowed range.";
  if (!inRange(rule.duplicateStartWindowMin, 0, 180)) return "Duplicate window is outside the allowed range.";
  if (!inRange(rule.maxNotesLength, 1, 2_000)) return "Notes limit is outside the allowed range.";
  if (!inRange(rule.maxLoadGrams, 1, 500_000)) return "Load limit is outside the allowed range.";
  if (!rule.types || typeof rule.types !== "object") return "Scoring rule has no workout types.";

  for (const [name, typeRule] of Object.entries(rule.types)) {
    if (!typeRule || !inRange(typeRule.multiplierHundredths, 1, 1_000)) {
      return `Multiplier for ${name} is outside the allowed range.`;
    }
  }

  for (const intensity of INTENSITIES) {
    const pointsWeight = rule.intensityHundredths?.[intensity];
    const loadWeight = rule.intensityLoadHundredths?.[intensity];
    if (!inRange(pointsWeight, 1, 200) || !inRange(loadWeight, 1, 300)) {
      return `Intensity ${intensity} is not configured.`;
    }
  }

  if (!Array.isArray(rule.allowedWhenLimited)) return "Limited-activity list is invalid.";
  for (const typeName of rule.allowedWhenLimited) {
    if (!rule.types[typeName]) return "Limited-activity list names an unknown workout type.";
  }
  return null;
}

function validateDraft(input: ScoreInput): { code: ScoreDecision["rejectCode"]; message: string } | null {
  const workout = input.workout;
  const rule = input.rule;
  if (!workout || typeof workout.type !== "string" || !rule.types[workout.type]) {
    return { code: "invalid_type", message: "Choose a supported workout type." };
  }
  if (typeof workout.occurredOn !== "string" || !isRealCivilDate(workout.occurredOn)) {
    return { code: "invalid_date", message: "Enter a real workout date." };
  }
  if (!Number.isInteger(workout.durationMin) || !inRange(workout.durationMin, rule.minDurationMin, rule.maxDurationMin)) {
    return {
      code: "invalid_duration",
      message: `Duration must be a whole number of minutes from ${rule.minDurationMin} to ${rule.maxDurationMin}.`,
    };
  }
  if (workout.intensity != null && !INTENSITIES.includes(workout.intensity)) {
    return { code: "invalid_intensity", message: "Intensity is not recognized." };
  }
  if (workout.notes != null && (typeof workout.notes !== "string" || workout.notes.length > rule.maxNotesLength)) {
    return { code: "invalid_notes", message: "Notes are too long." };
  }
  if (workout.clientRequestId != null && (typeof workout.clientRequestId !== "string" || !CLIENT_REQUEST_ID.test(workout.clientRequestId))) {
    return { code: "invalid_client_request", message: "Submission id is invalid." };
  }

  const intervalError = validateInterval(workout, input.timeZone);
  if (intervalError) return intervalError;

  const exerciseError = validateExercises(workout, rule);
  if (exerciseError) return exerciseError;
  return null;
}

function validateCalendar(input: ScoreInput): { code: ScoreDecision["rejectCode"]; message: string } | null {
  let today: string;
  try {
    today = civilDateInTimeZone(input.now, input.timeZone);
  } catch {
    return { code: "invalid_date", message: "Club timezone is not available." };
  }
  const occurredOn = input.workout.occurredOn;
  if (compareCivil(occurredOn, today) > 0) {
    return { code: "future_date", message: "Workouts cannot be logged in the future." };
  }
  const oldest = addDays(today, -input.rule.backdateDays);
  if (compareCivil(occurredOn, oldest) < 0) {
    return { code: "outside_backdate_window", message: "That date is outside the scoring window." };
  }
  if (input.offseasonStart && compareCivil(occurredOn, input.offseasonStart) < 0) {
    return { code: "outside_offseason", message: "That date is before the offseason." };
  }
  if (input.offseasonEnd && compareCivil(occurredOn, input.offseasonEnd) > 0) {
    return { code: "outside_offseason", message: "That date is after the offseason." };
  }
  return null;
}

function validateMeasurements(input: ScoreInput): { code: ScoreDecision["rejectCode"]; message: string } | null {
  const workout = input.workout;
  const typeRule = input.rule.types[workout.type] as TypeRule;
  const distance = workout.distanceM;
  if (distance != null) {
    if (!typeRule.allowsDistance || !Number.isInteger(distance) || distance <= 0) {
      return { code: "invalid_distance", message: "Distance is not valid for this workout." };
    }
    if (typeRule.maxDistanceM != null && distance > typeRule.maxDistanceM) {
      return { code: "invalid_distance", message: "Distance is above the limit for one session." };
    }
    if (typeRule.minPaceSecPerKm != null) {
      const pace = (workout.durationMin * 60_000) / distance;
      if (pace < typeRule.minPaceSecPerKm) {
        return { code: "implausible_pace", message: "That pace is not plausible for a full session." };
      }
    }
    if (typeRule.minSplitSecPer500 != null) {
      const split = (workout.durationMin * 30_000) / distance;
      if (split < typeRule.minSplitSecPer500) {
        return { code: "implausible_split", message: "That rowing split is not plausible for a full session." };
      }
    }
  }
  return null;
}

function validateExercises(
  workout: WorkoutDraft,
  rule: ScoringRule,
): { code: ScoreDecision["rejectCode"]; message: string } | null {
  if (workout.exercises == null) return null;
  if (!Array.isArray(workout.exercises) || workout.exercises.length > 40) {
    return { code: "invalid_exercise", message: "Exercise list is invalid." };
  }
  for (const exercise of workout.exercises) {
    if (!exercise || typeof exercise.name !== "string" || exercise.name.trim().length === 0 || exercise.name.length > 80) {
      return { code: "invalid_exercise", message: "Each exercise needs a name." };
    }
    if (exercise.sets != null && (!Number.isInteger(exercise.sets) || !inRange(exercise.sets, 1, 100))) {
      return { code: "invalid_exercise", message: "Sets must be a whole number from 1 to 100." };
    }
    if (exercise.reps != null && (!Number.isInteger(exercise.reps) || !inRange(exercise.reps, 1, 1_000))) {
      return { code: "invalid_exercise", message: "Reps must be a whole number from 1 to 1000." };
    }
    if (exercise.durationMin != null && (!Number.isInteger(exercise.durationMin) || !inRange(exercise.durationMin, 1, 240))) {
      return { code: "invalid_exercise", message: "Exercise duration is invalid." };
    }
    if (exercise.distanceM != null && (!Number.isInteger(exercise.distanceM) || !inRange(exercise.distanceM, 1, 200_000))) {
      return { code: "invalid_exercise", message: "Exercise distance is invalid." };
    }
    if (exercise.loadGrams != null) {
      if (!Number.isInteger(exercise.loadGrams) || exercise.loadGrams <= 0) {
        return { code: "invalid_exercise", message: "Load must be a positive whole number of grams." };
      }
      if (exercise.loadGrams > rule.maxLoadGrams) {
        return { code: "implausible_load", message: "That load is above the club limit." };
      }
    }
  }
  return null;
}

function validateInjury(input: ScoreInput): { code: ScoreDecision["rejectCode"]; message: string } | null {
  if (input.athlete.trainingLocked || input.athlete.injuryStatus === "out") {
    return {
      code: "injury_hold",
      message: "Training is on hold, so this session cannot score.",
    };
  }
  if (input.athlete.injuryStatus === "limited") {
    if (!input.rule.allowedWhenLimited.includes(input.workout.type)) {
      return {
        code: "limited_type_blocked",
        message: "That workout type is not cleared while availability is limited.",
      };
    }
    if (input.workout.intensity !== "easy") {
      return {
        code: "limited_intensity_blocked",
        message: "Limited availability can only score easy sessions.",
      };
    }
  }
  return null;
}

function findIdempotent(input: ScoreInput): PriorWorkout | undefined {
  const requestId = input.workout?.clientRequestId;
  if (!requestId) return undefined;
  return input.history.find(
    (prior) => prior.clientRequestId === requestId && prior.status !== "voided",
  );
}

function weeklyLoadExceeds(input: ScoreInput): boolean {
  const loads = new Map<string, number>();
  for (const prior of counted(input)) {
    addLoad(loads, prior.occurredOn, loadMinutes(prior.durationMin, loadWeight(input.rule, prior.intensity)));
  }
  const workout = input.workout;
  const ownWeight = loadWeight(input.rule, workout.intensity ?? "moderate");
  addLoad(loads, workout.occurredOn, loadMinutes(workout.durationMin, ownWeight));

  for (let offset = -6; offset <= 0; offset += 1) {
    const start = addDays(workout.occurredOn, offset);
    let sum = 0;
    for (let day = 0; day < 7; day += 1) {
      sum += loads.get(addDays(start, day)) ?? 0;
    }
    if (sum > input.rule.weeklyLoadLimit) return true;
  }
  return false;
}

function sameDayPoints(input: ScoreInput): number {
  return counted(input)
    .filter((prior) => prior.occurredOn === input.workout.occurredOn)
    .reduce((sum, prior) => sum + prior.awardedPointsTenths, 0);
}

function counted(input: ScoreInput): PriorWorkout[] {
  return input.history.filter((prior) => COUNTED.has(prior.status));
}

function loadWeight(rule: ScoringRule, intensity: Intensity | null): number {
  return rule.intensityLoadHundredths[intensity ?? "moderate"];
}

function loadMinutes(durationMin: number, weightHundredths: number): number {
  return roundDiv(durationMin * weightHundredths, 100);
}

function addLoad(loads: Map<string, number>, date: string, amount: number): void {
  loads.set(date, (loads.get(date) ?? 0) + amount);
}

function validateInterval(
  workout: WorkoutDraft,
  timeZone: string,
): { code: ScoreDecision["rejectCode"]; message: string } | null {
  if (workout.startedAt == null && workout.endedAt == null) return null;
  if (typeof workout.startedAt !== "string") {
    return { code: "invalid_interval", message: "The start and end times are not a real interval." };
  }
  const startMs = Date.parse(workout.startedAt);
  if (!Number.isFinite(startMs)) {
    return { code: "invalid_interval", message: "The start and end times are not a real interval." };
  }
  const startedOn = civilDateInTimeZone(new Date(startMs), timeZone);
  if (startedOn !== workout.occurredOn) {
    return {
      code: "date_time_mismatch",
      message: "The start time falls on a different date than the one submitted.",
    };
  }
  if (workout.endedAt == null) return null;
  if (typeof workout.endedAt !== "string") {
    return { code: "invalid_interval", message: "The start and end times are not a real interval." };
  }
  const endMs = Date.parse(workout.endedAt);
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    return { code: "invalid_interval", message: "The start and end times are not a real interval." };
  }
  if (Math.abs((endMs - startMs) / 60_000 - workout.durationMin) > 1) {
    return { code: "duration_mismatch", message: "Duration does not match the start and end times." };
  }
  return null;
}

function inRange(value: number | undefined, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function integerOrZero(value: number | undefined): number {
  return Number.isInteger(value) ? (value as number) : 0;
}
