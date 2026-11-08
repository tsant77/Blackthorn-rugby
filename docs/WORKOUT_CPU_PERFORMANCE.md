# Workout CPU performance validation

This follow-up targets the 10 ms Workers Free budget without changing scoring rules, authentication, or production. PR #6 was merged into the application branch first. The initial development baseline with 0, 500 and 2,500 archived synthetic workouts measured submission/deletion/history CPU maxima of 16/13/25 ms; the largest history response was about 2 MB.

## Changes and invariants

- History is keyset-paginated: 20 entries by default, at most 25, with deterministic date/created-time/ID ordering. `nextCursor` reaches older pages. Every query remains scoped to the session's profile; a cursor conveys no authority. Invalid cursors and limits return 400.
- The mobile log offers “Load older sessions”. Home asks D1 for three counted sessions before limiting, and does not fetch scoring context. Full history remains accessible; no stored records are truncated.
- Deletion reads ownership, revision and ledger net together, then retains the existing revision guard, reversal, consistency updates and audit in one D1 transaction. It uses the recorded scoring version. Legacy null versions retain the previous current-rule fallback. Permanent badge awards need no lifetime rescan after deletion; badge reads still synchronize newly configured awards.
- Submission/edit responses select one workout and its ledger total. Workout-only requests avoid computing leaderboard date ranges. Rule, measurement, injury, ownership, CSRF and permission validation remain enabled.
- Training-load checks use seven rolling sums over thirteen calendar days, with the same counted statuses, overlapping windows, strict threshold and individual rounding. Tests compare results against exhaustive windows at boundary values.
- Badge statistics return one aggregated row from D1. Indexed streak existence checks stop at the first missing date. The exact lifetime counts, points and streak are preserved. Badge and notification writes share an idempotent transaction.

No schema migration or scoring publication is required. Existing daily-cap SQL, week snapshots, revision guards, immutable ledger/audit triggers and security checks remain in place. Do not move accounting to deferred background work to mask CPU use.

## Development deployment and measurement

1. Verify the PR source, CI, authenticated Cloudflare account, `blackthorn-rugby-dev` Worker and its development-only D1 UUID. Confirm `EMAIL_PROVIDER=none`; preserve redacted invocation logs. Record production metadata only for the no-change comparison.
2. Export and protect a fresh development D1 backup before fixtures. Create only clearly named synthetic Player accounts. Populate substantial archived histories plus ordinary recent training. Record D1 rows read/written and keep the full exercise within Free quotas. Never target production or publish club scoring rules.
3. Run typecheck, unit/integration tests, build and mobile browser tests. Package with the explicit development environment and minification. Deploy only to the existing development Worker; record exact source and Worker version.
4. Keep private, mode-0600 benchmark input as an array of `{ "synthetic": true, "historySize": 2512, "cookie": "blackthorn_session=…" }` for each synthetic Player. The script verifies development origin, synthetic name prefix and Player role before mutations. Do not commit or print cookies/personal links.
5. Run from the repository root:

   ```sh
   RUN_DEV_WORKOUT_BENCHMARK=approved DEV_WORKOUT_INPUT=/private/input.json DEV_WORKOUT_VERSION=verified-version DEV_WORKOUT_OUTPUT=/private/results.json node scripts/benchmark-dev-workouts.mjs
   ```

   Use the environment's supported proxy configuration when needed. The script checks default, maximum, recent and older pages, then submission concurrency 1/4/8 and deletion. It records byte counts, response status, wall time and per-history UTC windows. It deletes only workouts it just created. CPU must come from actual invocation telemetry, not client timing.

6. Query invocation count, CPU p50/p95/max, response status and resource outcomes by endpoint and exact deployed version. Inspect cold and warm samples and each history window; do not omit or discard outliers. Require **every sampled request below 10 ms**, preferably p95 at or below 5 ms, no CPU/resource errors, correct ledger effects and working pagination. An HTTP 200 alone does not establish compatibility. Report any failure honestly and continue profiling.
7. Recheck cross-player access, idempotency, concurrent caps, edit/delete/void/restore reversals, history totals and rule-version preservation. Verify original rules/awards and production metadata remain unchanged.
8. Revoke/deactivate synthetic accounts and the temporary staff session. Reverse synthetic fixture ledger contributions and mark fixture workouts voided without editing original ledger/audit rows. Keep token-free results in the PR; preserve private backups and credentials outside version control.

The final development measurements, deployed source/version and outstanding gates belong in the performance PR and its attached token-free evidence. No production deployment or merge of this new performance PR is implied.

References: [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 query-result limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
