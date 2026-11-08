# Scoring specification

Status: version 1 of the rules, implemented by `@blackthorn/scoring`. The HTTP API that calls it is Phase 3.

Normative words: MUST, MUST NOT, and MAY.

## Authority

The server MUST compute points. A client payload that includes `points`, `awardedPoints`, `pointsTenths`, `awardedPointsTenths`, or `score` at any depth MUST be rejected before scoring. `assertClientCannotSetPoints` enforces that.

Awarded points MUST NOT be a column the client can write. They live only in `point_transactions`.

The engine is a pure function. It MUST NOT read the database. The API loads the active rule, the athlete, and the history window, then calls `scoreWorkout`.

## Versioning

A scoring rule version is immutable once its status is `active`. A change MUST insert a new row with the next version number and a new `config_json` snapshot.

Only one version per club MAY be `active` (partial unique index).

Sessions store the `rule_version_id` they were judged under. Changing the active version MUST NOT rewrite old ledger rows. An admin recompute, later, posts reversals and new awards. It does not update history in place.

`defaultRule()` is the recommended version 1. It is not inserted by the migration, because a club row does not exist yet. The admin UI publishes it.

## Formula

Points are stored as integer tenths. 6.0 points is `60`. Display with one decimal via `formatPoints`.

For duration `m` minutes, type multiplier `T` (hundredths, so 1.50× is `150`), and intensity multiplier `I` (hundredths):

```
gross tenths = round_half_up(m * T * I / 10000)
```

Omitted intensity MUST be treated as moderate (`I = 100`), except when availability is `limited` (see below).

### Published defaults

| Type | Multiplier | Distance |
| --- | --- | --- |
| Running | 1.50 | Optional, meters. Pace guard. |
| Rower | 1.50 | Optional, meters. Split guard. |
| Circuit training | 1.50 | No |
| Weight training | 1.25 | No. Load is recorded, not scored. |
| Rugby | 1.25 | No |
| Basketball | 1.00 | No |
| Football | 1.00 | No |

| Intensity | Points factor | Load factor |
| --- | --- | --- |
| Easy | 0.85 | 0.75 |
| Moderate | 1.00 | 1.00 |
| Hard | 1.15 | 1.25 |
| Max | 1.25 | 1.50 |

Worked examples at moderate intensity:

| Session | Gross |
| --- | --- |
| 40 min running | 6.0 |
| 40 min weight training | 5.0 |
| 40 min basketball | 4.0 |
| 40 min running, hard | 6.9 |
| 1 min running | 0.2 |
| 240 min running | 36.0 before caps |

Distance MUST NOT add points in version 1. It exists to reject impossible sessions and to feed later analytics. A plausible 8 km run scores the same as the same duration with no distance.

## Caps and the ledger

Defaults: session cap 15.0 points, daily cap 30.0 points, per player, per civil date in the club timezone.

```
after session = min(gross, session cap)
awarded       = min(after session, daily cap − points already awarded that date)
```

Already-awarded points are the net ledger total of that player's `submitted` and `approved` sessions on that date. `rejected` and `voided` sessions MUST NOT consume the cap.

An award MUST write:

1. `award` / `formula` for the gross tenths.
2. `cap_reduction` / `session_cap` when the session cap binds (negative).
3. `cap_reduction` / `daily_cap` when the daily cap binds (negative).

The sum of those rows MUST equal `awarded`. A session that hits a full daily cap is still an award of 0, so the work is on the calendar and the ledger shows why it did not pay.

Engine ceilings, so a bad config cannot mint points: daily and session caps at most 100.0 points, multipliers at most 10.00×, intensity points factor at most 2.00×, duration at most 240 minutes. A rule outside those bounds MUST be rejected as `invalid_rule` and MUST NOT score.

## Calendar

The club timezone for Blackthorn is `America/New_York` until an admin sets another.

- A civil date after today in that timezone MUST be rejected (`future_date`).
- A civil date older than `backdateDays` (default 7, inclusive) MUST be rejected (`outside_backdate_window`).
- If the caller passes an offseason start or end, dates outside that inclusive window MUST be rejected (`outside_offseason`). Null bounds mean "not configured," not "closed."
- If a start time is present, its civil date in the club timezone MUST equal `occurredOn`.

## Duplicates and overlaps

Checked in this order:

1. Same `clientRequestId` on a non-voided session: outcome `duplicate`, no new ledger rows. The API should return the original session. A voided session MAY be resubmitted with the same id.
2. Real time overlap with a counted session: `overlapping_session`. Touching endpoints (one ends when the next starts) are not an overlap. If only a start is present, the end is start plus duration.
3. Heuristic duplicate: same player, type, civil date, and duration, and either both sessions have no start time, or both starts fall within `duplicateStartWindowMin` (default 15). Outcome `reject` / `duplicate_submission`.

Known hole: a session with a start time is not treated as a heuristic duplicate of a same-day session that has no start time. Overlap still applies when the timed session can be placed. Players who train twice in a day should send start times.

When editing, the caller MUST omit the session being edited from `history`. Otherwise it overlaps itself. `planReversal(netTenths)` builds the ledger row that cancels the previous net award before the new decision is posted.

## Injury and overtraining

| Athlete state | Result |
| --- | --- |
| `out`, or `trainingLocked` | `injury_hold`. No points. |
| `limited`, type not in `allowedWhenLimited` | `limited_type_blocked`. Default list is empty. |
| `limited`, intensity is anything but explicit `easy` | `limited_intensity_blocked`. |
| `limited`, allowed type, easy | Score normally, including caps. |

Weekly load is the sum of weighted minutes. Weight is the load factor for the session's intensity (moderate when missing). A session MUST be rejected with `overtraining_guard` and zero transactions when adding it would make any 7-civil-day window that includes its date exceed `weeklyLoadLimit` (default 600). Landing exactly on the limit is allowed.

The API MUST pass every non-voided session in `[occurredOn − 6 days, occurredOn + 6 days]`. The engine cannot see sessions it is not given. Rejected and voided sessions MUST NOT count toward load or caps.

This guard refuses the whole session. It does not award a trimmed amount. Partial credit would still reward the unsafe day.

## Implausible measurements

- Running average pace faster than 2:30 per km (`minPaceSecPerKm = 150`) MUST be rejected. Exactly 2:30 is allowed.
- Rowing average split faster than 1:20 per 500 m (`minSplitSecPer500 = 80`) MUST be rejected. Exactly 1:20 is allowed.
- Any exercise load above 400.000 kg (`400000` grams) MUST be rejected. Exactly 400 kg is allowed.
- Distance on a type that does not allow it MUST be rejected.
- Duration MUST be a whole number of minutes from 1 to 240.
- Notes longer than 500 characters MUST be rejected.

These limits are on the rule object so a later version can move them with an audit trail. The engine ceilings above still apply.

## Reject codes

`invalid_rule`, `rule_not_active`, `invalid_type`, `invalid_date`, `invalid_duration`, `invalid_intensity`, `invalid_distance`, `invalid_interval`, `duration_mismatch`, `date_time_mismatch`, `invalid_notes`, `invalid_exercise`, `invalid_client_request`, `future_date`, `outside_backdate_window`, `outside_offseason`, `implausible_pace`, `implausible_split`, `implausible_load`, `injury_hold`, `limited_type_blocked`, `limited_intensity_blocked`, `overlapping_session`, `duplicate_submission`, `overtraining_guard`.

Idempotent retries use outcome `duplicate` and are not a reject code.

## Interface

```ts
scoreWorkout(input: ScoreInput): ScoreDecision
assertClientCannotSetPoints(payload: unknown): void
planReversal(netAwardedTenths: number): PointTransactionDraft
defaultRule(): ScoringRule
formatPoints(tenths: number): string
```

`ScoreDecision.outcome` is `award`, `reject`, or `duplicate`. `transactions` is empty unless the outcome is `award`. `ruleVersion` echoes the rule that was passed in. The engine does not decide which version is active.

## Deferred

- Approval queues changing whether `submitted` points sit on the board.
- Achievement math and challenge bonuses.
- Admin adjustments (`kind = adjustment`), which Phase 5 writes directly to the ledger with an audit event.
- Recompute jobs across a roster.
