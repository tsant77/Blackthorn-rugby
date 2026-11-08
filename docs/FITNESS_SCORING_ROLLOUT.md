# Fitness scoring: review and development rollout

## Review boundary and coordination

Authentication PR #4 has merged into `cursor/blackthorn-workout-tracker-7301`.
This separate scoring-only PR targets that branch, using its merged authentication
implementation unchanged. Re-run checks after any later merge/rebase.
Migration 0008 follows authentication's
0007; do not rename or reorder either. Workers Free and D1 Free are the deployment
targets. No external service, email sender, paid resource, or new binding is added.
No remote migration, deployment, billing change, or real account creation is part
of this PR. Production must remain untouched.

## Rule model and default switch

The new defaults are ready in **Club → Scoring Settings**. They are NOT silently
written over the live rule. An administrator previews the proposed settings and
publishes an effective date to start the new scoring system. This explicit step
preserves old records and allows a club to choose its transition date.

| Activity | Points / 10 min | Training categories |
| --- | ---: | --- |
| Sprint / HIIT | 12 | Speed, Endurance |
| Rugby training | 11 | Strength, Speed, Endurance |
| Running | 10 | Endurance |
| Circuit training | 10 | Strength, Endurance |
| Rowing | 9 | Strength, Endurance |
| Weight training | 9 | Strength |
| Basketball | 8 | Speed, Endurance |
| Football | 8 | Speed, Endurance |
| Walking / active recovery | 4 | Recovery |

Easy 0.75×, Moderate 1.00×, Hard 1.25×, Maximum 1.40×. Formula:
`minutes / 10 × activity points per 10 minutes × intensity`, rounded half-up to
one decimal point using integer arithmetic. The default workout cap is 60 points
and daily workout-points cap is 100. Existing internal activity IDs, including
`rower` and `rugby`, are retained. New IDs are `sprint_hiit` and `walking`.

Administrators can add activity IDs, rename display labels, disable/re-enable
activities, assign multiple training categories, adjust rates/intensities/caps,
set weekly consistency thresholds, preview, publish an effective date, and review
previous configurations. IDs already present in any historical version cannot
be deleted or renamed. Disable them instead. Configurations have 1–32 activities,
bounded integer rates/caps, ordered intensity weights, valid categories and
measurement limits; the server validates both preview and publication. The older
caps API is a validated compatibility adapter; the old UI links to Scoring Settings.

New workouts select the newest eligible rule by **workout civil date**, then
version, in the club timezone. A future version cannot affect earlier dates, and
an older scheduled version cannot later replace a newer effective date. Publishing
uses an expected version check inside D1 to reject concurrent/stale publishers.
Existing awards never reprice when a new rule is published. Edits retain the
workout's original rule ID and append a reversal plus a replacement award. They
cannot move a workout before that version's effective date. Delete/re-log is the
explicit path when a different date/version is needed. Unchanged workout points
and original ledger rows remain intact. Historical labels/categories are resolved
from the saved rule; legacy types without categories use the documented defaults.

## Weekly consistency and training balance

Default tiers: 3 qualifying days = +5, 4 = +8 total, 5 = +10 total. Only the highest
applicable tier is awarded. Additional sessions or six/seven days do not increase
that bonus. A day qualifies after at least 20 combined minutes of counted training
(default; configurable 10–60), including easy walking/recovery. Intensity is not a
consistency multiplier. Admins may disable tiers or configure increasing thresholds
from 2–5 days with total bonuses up to 20 points. Workload and injury guards remain.
There is no extra consistency incentive for repeated maximum-intensity sessions.

Weeks run Monday–Sunday in the club timezone. A week's consistency configuration
comes from its Monday rule and is pinned when first used. Midweek publications
change workout scoring prospectively; their consistency settings start the next
week. This avoids repricing bonuses partway through the week. A week predating
the fitness effective date has no new consistency reward. Bonus ledger entries
are dated Monday for consistent weekly/monthly accounting; a cross-month week's
whole bonus belongs to that Monday's month. Weekly bonuses and explicit admin
adjustments are separate from daily workout-point caps and are visible in history.

A compact weekly state row stores the pinned rule ID, bonus settings and current
award. Each workout create/edit/delete or staff reject/void/restore recomputes
only the affected seven-day week(s), in the same D1 batch as the workout and ledger
mutation. Only the delta is appended: 3→4 days adds +3, 5→4 days appends −2.
Repeated actions cannot accumulate the same tier. Corrections never delete history.
Restoration respects the daily cap and zero-point closures cannot resurrect an
older edit's award. Revision guards roll back stale competing edits/moderation.
The daily cap is applied against the live ledger inside the batch, so simultaneous
submissions cannot overspend it. Submission IDs remain spent after deletion and
concurrent retries return the saved workout without awarding twice.

Dashboard/profile training balance uses counted minutes, not capped points or
maximum-intensity multipliers. Time is split equally across an activity's categories.
These are **training indicators, not clinically validated fitness measurements**.
Recovery/rest guidance appears beside the indicators. Voided/rejected sessions
stop contributing. No medical assessment or new personal information is collected.

## Migration and Free performance

`0008_fitness_scoring.sql` only adds:

- `workouts.scoring_revision` (NOT NULL default 0), used as a transaction conflict guard.
- `weekly_consistency` with a unique profile/week index and compact pinned bonus settings.
- An index on scoring rules by club, effective date and version.

It does not rebuild or delete workouts, update old scoring JSON, or rewrite ledger,
user/profile, award or audit rows. Existing indexed player/date and workout-ledger
lookups serve caps and seven-day bonus queries. Bonus calculation runs once per
changed week inside D1; no full-history recalculation, background polling or new
scheduled job is used. GET rule selection is read-only. Training balance aggregates
by recorded rule and type over the season. Scoring history is bounded to 100 entries.

Local tests and packaging do not establish the deployed Worker CPU time. After an
approved dev rollout, measure cold/warm create/edit/moderation/settings-preview
invocations (including consistency tier transitions), 1/2/4/8 concurrent submissions,
D1 rows read/written, and resource outcomes. Require CPU below Workers Free's 10 ms
allowance, no exceededCpu errors, correct caps/bonuses and quota headroom. Prefer
p95 CPU ≤5 ms. Profile/fix any hot path; do not move to Paid or weaken integrity.
See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Development deployment plan — explicit approval required

1. Confirm authentication PR #4 is present, then merge the approved scoring commit. Verify
   exact branch/SHA, a clean checkout, and that only expected migrations are pending.
2. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`, and
   `PW_BROWSER=webkit npx playwright test e2e/fitness-scoring.spec.ts e2e/team-rollout.spec.ts`.
   Re-run Drizzle generation and require no schema changes.
3. Confirm Cloudflare authentication, existing `blackthorn-rugby-dev` Worker and
   distinct `blackthorn-rugby-dev` D1 UUID, `EMAIL_PROVIDER=none`, dev APP_ORIGIN,
   D1/assets-only bindings, Free settings, and query-string log redaction. Configure
   CLI credentials privately if still absent. Never change billing or production.
4. Export/checksum development D1 before migration and restore it locally to verify
   backup integrity and additive migration preservation. Do not copy production data.
5. Set only the local `[env.dev]` DB UUID. From `apps/api`, always use `--env dev`:
   ```sh
   npx wrangler d1 migrations list blackthorn-rugby-dev --env dev --remote
   npx wrangler d1 migrations apply blackthorn-rugby-dev --env dev --remote
   npx wrangler deploy --env dev --dry-run
   npx wrangler deploy --env dev
   ```
   Review bindings before the real deploy. Apply only pending migrations, including
   0006/0007 if still outstanding, then 0008. Never omit `--env dev`.
6. Record the dev URL, version, commit, migration/binding output and backup checksum.
   Confirm production received no deployments, migrations or test writes.
7. With synthetic accounts only, compare old workout/ledger totals before/after;
   preview and publish fitness defaults for an approved effective date. Test all
   nine rates and intensities, session/day caps, disabled/custom activities, coach/
   Player permission denials, stale publishing, backdated rules, edits across dates,
   all correction paths and bonus tiers. Create at least three separate qualifying
   days using the allowed backdate window. Test concurrent caps and idempotency.
   Verify group/position boards, dashboard/profile totals, category allocation and
   visible admin adjustments/history against ledger sums. Do not alter server time
   or backdate a production rule to manufacture a test.
8. Collect the actual Free CPU/D1 measurements above and repeat physical iPhone
   Safari checks. Fix failures before accepting the development rollout. Publish no
   production release or new real-player rules without separate approval.

## Rollback

Retain additive schema and all ledger/state history. A code rollback must not allow
the old app to mutate workouts with outstanding consistency rewards, because it
does not know how to reverse those rewards. Before rollback, pause workout mutations
or deploy a compatibility build that preserves consistency maintenance. Never undo
bonuses by deleting ledger rows or clearing weekly state. Restoring the old scoring
rates should normally be a new prospective rule version, not a data rollback.

## Validation recorded for this PR

- Workspace TypeScript checks and 96 unit/integration tests passed (47 API, 44 scoring, 3 database, 2 web).
- All 14 Chromium end-to-end tests passed, including two new mobile fitness scenarios and axe checks.
- All 5 WebKit fitness/rollout scenarios passed using the validated workspace-local official browser libraries.
- Application build and development packaging dry run passed with D1/assets only and email disabled.
- Drizzle regeneration reports no schema changes.
- A local restore of the development-only backup preserved every existing column value across 25 tables after 0006, 0007 and 0008; integrity check passed.
- Actual development Worker CPU, concurrent smoke checks on the deployed version, and physical iPhone checks remain approval-gated. No remote migrations or deployments were run.
