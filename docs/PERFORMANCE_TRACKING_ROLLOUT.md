# Optional performance tracking

This change implements optional tracking, performance boards, player activity logs linked from every leaderboard, and an explicit administrator switch to MET-based scoring with retrospective recalculation. Old point totals are intentionally replaced when that switch is applied. Deployment alone does not activate MET scoring.

## MET switch and recalculation

Scoring Settings → Preview MET recalculation → Apply MET scoring to all workouts changes all club workouts and future logging to a new MET rule. The formula is `points = reference MET × minutes / 6 × club intensity factor`, rounded once to tenths. Easy/moderate/hard/max factors are 0.75/1/1.25/1.4; these factors and the division by six are club game design, not Compendium measurements. Session/daily caps become 120/200 points. Existing weekly consistency rewards, training-load/injury restrictions and standalone manual adjustments remain in place. Missing historical intensity uses moderate, matching existing logging behavior. Historical sessions are not rejected using today's injury status or backdate window.

Reference METs from the [2024 Adult Compendium](https://pacompendium.com/): weights 3.5 (02054), running 8 (12150), cycling 7 (01016), stationary rowing 5 (02071), circuit 5 (02035), competitive rugby 8.3 (15560), non-game basketball 6 (15050), competitive football 8 (15210), moderate walking 3.8 (17190), moderate HIIT 7 (02210). References: [conditioning](https://pacompendium.com/conditioning-exercise/), [running](https://pacompendium.com/running/), [cycling](https://pacompendium.com/bicycling/), [sports](https://pacompendium.com/sports/), [walking](https://pacompendium.com/walking/). These are estimates for broad recorded activity categories; historical workouts lack detailed pace/wattage or rest-time measurements. They are not individualized calorie measurements. A moderate 60-minute weights session becomes 35 points; hard becomes 43.8, maximum 49. Distance sports stay separate and mileage never adds points.

The preview binds the current rule/version and every workout's revision, status, rule, and ledger sum to a SHA-256 token. Applying checks the token, then atomically checks rule version, workout count and each stored revision/status/ledger sum before any updates. Concurrent insert/edit/void/scoring publication invalidates the preview. A failed guard rolls the batch back. Reusing a completed token returns its prior result without duplicate point changes. Sessions are allocated daily caps by stable player/date/created-time/ID ordering. Rejected/deleted/voided records remain zero; restoring them later uses the MET formula rather than resurrecting the old award. Edits and new backdated workouts use the MET baseline. Future prospective rule scheduling retains calendar precedence above that baseline.

The existing immutable ledger is corrected with deltas, and historical workouts are pinned to the new rule. This changes current totals, dashboards, leaderboards and history displays without removing required database triggers. No new schema migration is needed for MET itself; optional-metrics migration 0010 still precedes this application build. Recalculation currently refuses more than 1,000 counted or nonzero-score club workouts, scheduled future versions, or unknown activity-to-MET mappings; resolve those cases or perform a measured offline rollout instead of guessing values or partially updating a club.

All members can open another player's basic activity log from a leaderboard name, including older activities through bounded pagination. Notes, calories and lifting details are not exposed by this public log endpoint.

## Player experience

- Logging still needs only activity, date, duration and intensity. Distance supports miles or kilometers for activities whose recorded scoring rule permits distance.
- Optional lifting entries offer **leg press, squat and bench press**. Record the load and reps; sets are optional (one set when omitted). Loads normalize to integer grams; the form supports lb and kg. Club load limits still apply.
- PRs are calculated from currently counted workouts for each exercise **and rep count**. A five-rep bench record never competes with a one-rep bench record. No estimated 1RM or maximal lifting attempt is required. Strength rankings show the heaviest load for the selected exercise/reps in the period.
- My progress shows weekly running, cycling and rowing totals, unverified calorie totals, rep-specific PRs and training volume. Missing metrics are never inferred.
- Running, cycling and rowing are **separate distance boards**. No combined mileage, conversion between sports, distance-derived bonus points, or calorie competition is introduced. Each board offers week, month and offseason filters, group/position filters, shared ranks for exact ties and a top-100 result limit.
- Improvement uses the first recorded day's best load as baseline, and requires a higher best on a later day in the same selected period/exercise/rep count. Consistency counts distinct dates with at least one session meeting the current club consistency minimum (20 minutes if unconfigured).
- Performance sharing defaults OFF for every player. Opt-in affects performance boards, including consistency; overall points participation is unchanged. Personal progress remains private to the signed-in profile. Existing team activity displays no new private metrics.

### Cycling availability

Before the MET switch, seeded rules have no cycling activity. Applying MET scoring adds cycling at 7 METs with distance enabled. An already configured cycling activity retains its existing availability and distance configuration. Running and rowing retain all existing distance validation.

## Data and API

Migration `0010_performance_tracking.sql` adds nullable calorie fields, an opt-in visibility flag and an exercise lookup index. Existing `distance_m` and `workout_exercises` are reused. It performs no table replacement, destructive updates, backfill or ledger writes. Custom historical exercise names remain stored; the new entry form offers the three supported lifts.

POST/PATCH `/api/workouts` accepts optional `calories`, `calorieSource` (`device` or `estimated`), and up to 20 `exercises` (`name`, optional `sets`, `reps`, `loadGrams`). Distance accepts `distanceMiles` or `distanceKilometers`, never both. Omitted calorie/exercise fields on PATCH preserve stored values; explicit null calories or an empty exercise array clears them. Metric writes share the workout/scoring/revision transaction. Existing idempotency tokens prevent duplicate entries and lifts. Input limits and recorded-rule load/distance checks reject implausible measurements before any writes.

GET `/api/performance` returns only the current profile's progress and records. PATCH `/api/performance/privacy` changes only that profile's sharing preference. GET `/api/performance/leaderboard` requires authentication and filters active memberships, opted-in profiles and submitted/approved workouts in SQL. Deleted, rejected and voided workouts cannot contribute to PRs or performance rankings; restoring a workout automatically restores its contribution. Records are derived rather than cached, avoiding stale PRs after edits/moderation.

## Validation and release gates

Local checks: workspace typecheck, unit/integration tests, build, Playwright browser/accessibility checks, and Drizzle regeneration. The migration preservation test applies all earlier migrations, seeds synthetic historical workout/exercise/ledger records, captures every original column in every existing table, applies 0010 and verifies equality, integrity, foreign keys and the immutable ledger trigger. This verifies a synthetic fixture, not a production backup.

Before any production release:

1. Review the PR and CI at the exact release commit. Confirm that all existing point totals are to be recalculated under the documented MET formula.
2. Export and verify a recoverable backup of the intended environment. Restore it to an isolated local/development database and compare every pre-existing column before/after migration; confirm integrity and foreign keys, workout counts, rule configurations and ledger sums.
3. Apply pending migrations (including 0009 before 0010) to isolated development D1, then deploy the candidate to the development Worker. Verify bindings point exclusively to development and email remains disabled. No remote migration/deployment is performed by this PR or CI.
4. Test optional/omitted metrics, lb/kg and mi/km conversion, edits, retries/concurrency, player logs, sharing, ties, periods, void/reject/restore and separate sport totals. Preview and apply MET on development, compare expected capped totals to the ledger/dashboard/boards, retry the same token, and validate editing/restoring historical sessions and fresh logging.
5. Measure actual Worker CPU and D1 behavior on representative histories and concurrent requests, especially the new aggregate queries and the expanded workout response. Local timing does not establish Workers Free CPU readiness. Check errors and bounded response sizes.
6. Confirm rollback and release readiness. Only then migrate production and deploy. Apply the MET switch after verifying production bindings and the preview totals. User authorization includes retroactive scoring; historical point preservation is not a requirement. Rolling code back does not revert database scoring changes: a pre-MET application cannot correctly edit MET-pinned workouts. Retain a MET-compatible build or pause mutations during rollback. Do not down-migrate the optional-metrics schema.

Production remains untouched until those gates pass.
