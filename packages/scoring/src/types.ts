/** Civil date in the club timezone, `YYYY-MM-DD`. */
export type CivilDate = string;

export const WORKOUT_TYPES = [
  "running",
  "weight_training",
  "rower",
  "circuit_training",
  "basketball",
  "rugby",
  "football",
  "sprint_hiit",
  "walking",
] as const;

export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const INTENSITIES = ["easy", "moderate", "hard", "max"] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const COUNTED_STATUSES = ["submitted", "approved"] as const;
export type WorkoutStatus = "submitted" | "approved" | "rejected" | "voided";

export interface ExerciseDraft {
  name: string;
  sets?: number | null;
  reps?: number | null;
  loadGrams?: number | null;
  durationMin?: number | null;
  distanceM?: number | null;
}

/**
 * What a player is allowed to send. There is intentionally no points field.
 * Awarded points are produced only by `scoreWorkout`.
 */
export interface WorkoutDraft {
  type: string;
  occurredOn: string;
  durationMin: number;
  intensity?: Intensity | null;
  distanceM?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  notes?: string | null;
  clientRequestId?: string | null;
  exercises?: ExerciseDraft[] | null;
}

export const FITNESS_CATEGORIES = ["strength", "speed", "endurance", "recovery"] as const;
export type FitnessCategory = (typeof FITNESS_CATEGORIES)[number];

export interface TypeRule {
  metHundredths?: number;
  label?: string;
  enabled?: boolean;
  categories?: FitnessCategory[];
  multiplierHundredths: number;
  allowsDistance: boolean;
  maxDistanceM: number | null;
  /** Reject running when average pace is faster than this (smaller number). */
  minPaceSecPerKm: number | null;
  /** Reject rowing when average split is faster than this. */
  minSplitSecPer500: number | null;
}

export interface ScoringRule {
  scoringModel?: "met-v1";
  consistency?: { days: number; pointsTenths: number }[];
  consistencyMinMinutes?: number;
  version: number;
  status: "draft" | "active" | "retired";
  dailyCapTenths: number;
  sessionCapTenths: number;
  /** Inclusive. A workout on `today - backdateDays` is allowed. */
  backdateDays: number;
  minDurationMin: number;
  maxDurationMin: number;
  /** Sum of weighted minutes across any 7 civil days that include the session. */
  weeklyLoadLimit: number;
  duplicateStartWindowMin: number;
  maxNotesLength: number;
  maxLoadGrams: number;
  /** Types a `limited` athlete may score, and only at easy intensity. */
  allowedWhenLimited: string[];
  types: Record<string, TypeRule>;
  /** Applied to the points formula. 100 = 1.00×. */
  intensityHundredths: Record<Intensity, number>;
  /** Applied to the overtraining load. 100 = 1.00× minutes. */
  intensityLoadHundredths: Record<Intensity, number>;
}

export interface AthleteContext {
  injuryStatus: "available" | "limited" | "out";
  trainingLocked: boolean;
}

export interface PriorWorkout {
  id: string;
  type: string;
  occurredOn: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMin: number;
  intensity: Intensity | null;
  status: WorkoutStatus;
  clientRequestId: string | null;
  /** Net points already on the ledger for this session. */
  awardedPointsTenths: number;
}

export interface ScoreInput {
  workout: WorkoutDraft;
  athlete: AthleteContext;
  rule: ScoringRule;
  /**
   * Other sessions for this athlete. The caller MUST include every
   * non-voided session whose civil date falls in
   * `[occurredOn - 6 days, occurredOn + 6 days]`, and every session that
   * shares `clientRequestId`. When rescoring, omit the session being edited.
   */
  history: PriorWorkout[];
  now: Date;
  timeZone: string;
  offseasonStart: CivilDate | null;
  offseasonEnd: CivilDate | null;
}

export const REJECT_CODES = [
  "invalid_rule",
  "rule_not_active",
  "invalid_type",
  "invalid_date",
  "invalid_duration",
  "invalid_intensity",
  "invalid_distance",
  "invalid_interval",
  "duration_mismatch",
  "date_time_mismatch",
  "invalid_notes",
  "invalid_exercise",
  "invalid_client_request",
  "future_date",
  "outside_backdate_window",
  "outside_offseason",
  "implausible_pace",
  "implausible_split",
  "implausible_load",
  "injury_hold",
  "limited_type_blocked",
  "limited_intensity_blocked",
  "overlapping_session",
  "duplicate_submission",
  "overtraining_guard",
] as const;

export type RejectCode = (typeof REJECT_CODES)[number];

export interface PointTransactionDraft {
  kind: "award" | "cap_reduction" | "reversal";
  pointsTenths: number;
  reasonCode: "formula" | "session_cap" | "daily_cap" | "reversal";
}

export interface ScoreDecision {
  outcome: "award" | "reject" | "duplicate";
  ruleVersion: number;
  grossPointsTenths: number;
  awardedPointsTenths: number;
  transactions: PointTransactionDraft[];
  flags: string[];
  rejectCode?: RejectCode;
  matchedWorkoutId?: string;
  message: string;
}

export class ClientPointsError extends Error {
  readonly code = "client_points_forbidden" as const;

  constructor() {
    super("Clients cannot submit or change awarded points.");
    this.name = "ClientPointsError";
  }
}
