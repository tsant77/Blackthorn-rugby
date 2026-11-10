# Optional performance tracking

This change implements tracking and performance boards only. It does not publish scoring rules, change points, rewrite historical workouts, or add device integrations.

## Player experience

- Logging still needs only activity, date, duration and intensity. Distance supports miles or kilometers for activities whose recorded scoring rule permits distance.
- Optional lifting entries offer **leg press, squat and bench press**. Record the load and reps; sets are optional (one set when omitted). Loads normalize to integer grams; the form supports lb and kg. Club load limits still apply.
- PRs are calculated from currently counted workouts for each exercise **and rep count**. A five-rep bench record never competes with a one-rep bench record. No estimated 1RM or maximal lifting attempt is required. Strength rankings show the heaviest load for the selected exercise/reps in the period.
- My progress shows weekly running, cycling and rowing totals, unverified calorie totals, rep-specific PRs and training volume. Missing metrics are never inferred.
- Running, cycling and rowing are **separate distance boards**. No combined mileage, conversion between sports, distance-derived bonus points, or calorie competition is introduced. Each board offers week, month and offseason filters, group/position filters, shared ranks for exact ties and a top-100 result limit.
- Improvement uses the first recorded day's best load as baseline, and requires a higher best on a later day in the same selected period/exercise/rep count. Consistency counts distinct dates with at least one session meeting the current club consistency minimum (20 minutes if unconfigured).
- Performance sharing defaults OFF for every player. Opt-in affects performance boards, including consistency; overall points participation is unchanged. Personal progress remains private to the signed-in profile. Existing team activity displays no new private metrics.

### Cycling availability

The club's seeded scoring rules have no cycling activity. The cycling board is ready for workouts with the stable `cycling` identifier. A coach/admin must explicitly configure and prospectively publish that activity using existing scoring settings, with distance enabled and an appropriate distance/pace limit. This PR deliberately does not choose a new cycling points rate or silently activate a scoring version. Running and rowing retain all existing rule validation.

## Data and API

Migration `0010_performance_tracking.sql` adds nullable calorie fields, an opt-in visibility flag and an exercise lookup index. Existing `distance_m` and `workout_exercises` are reused. It performs no table replacement, destructive updates, backfill or ledger writes. Custom historical exercise names remain stored; the new entry form offers the three supported lifts.

POST/PATCH `/api/workouts` accepts optional `calories`, `calorieSource` (`device` or `estimated`), and up to 20 `exercises` (`name`, optional `sets`, `reps`, `loadGrams`). Distance accepts `distanceMiles` or `distanceKilometers`, never both. Omitted calorie/exercise fields on PATCH preserve stored values; explicit null calories or an empty exercise array clears them. Metric writes share the workout/scoring/revision transaction. Existing idempotency tokens prevent duplicate entries and lifts. Input limits and recorded-rule load/distance checks reject implausible measurements before any writes.

GET `/api/performance` returns only the current profile's progress and records. PATCH `/api/performance/privacy` changes only that profile's sharing preference. GET `/api/performance/leaderboard` requires authentication and filters active memberships, opted-in profiles and submitted/approved workouts in SQL. Deleted, rejected and voided workouts cannot contribute to PRs or performance rankings; restoring a workout automatically restores its contribution. Records are derived rather than cached, avoiding stale PRs after edits/moderation.

## Validation and release gates

Local checks: workspace typecheck, unit/integration tests, build, Playwright browser/accessibility checks, and Drizzle regeneration. The migration preservation test applies all earlier migrations, seeds synthetic historical workout/exercise/ledger records, captures every original column in every existing table, applies 0010 and verifies equality, integrity, foreign keys and the immutable ledger trigger. This verifies a synthetic fixture, not a production backup.

Before any production release:

1. Review the PR and CI at the exact release commit. Confirm the three exercise names and rep-specific comparison rules with the club.
2. Export and verify a recoverable backup of the intended environment. Restore it to an isolated local/development database and compare every pre-existing column before/after migration; confirm integrity and foreign keys, workout counts, rule configurations and ledger sums.
3. Apply pending migrations (including 0009 before 0010) to isolated development D1, then deploy the candidate to the development Worker. Verify bindings point exclusively to development and email remains disabled. No remote migration/deployment is performed by this PR or CI.
4. Test optional/omitted metrics, lb/kg and mi/km conversion, edits, retries/concurrency, player isolation, sharing, ties, periods, void/reject/restore, separate sport totals and existing overall points. Validate historical workout editing. If cycling is wanted, review and publish its scoring configuration separately.
5. Measure actual Worker CPU and D1 behavior on representative histories and concurrent requests, especially the new aggregate queries and the expanded workout response. Local timing does not establish Workers Free CPU readiness. Check errors and bounded response sizes.
6. Confirm rollback and owner release approval. Only then migrate production and deploy. Keep additive columns/indexes and recorded exercises on rollback; rolling code back does not roll the DB back. The previous app ignores these new columns, and old clients omitting metrics preserve them. Do not down-migrate or remove history.

Production remains untouched until those gates pass.
