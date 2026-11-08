# Team registration and personal player login links

This replaces PR #3's password rollout. It is a proposed source change only: no
remote migrations, deployments, billing changes, or real player accounts are
authorized by this PR. Keep the mobile improvements from PR #3.

## Smallest migration

Keep the existing users, memberships, profiles, workout ownership guards, sessions,
scoring, ledger, boards, and reusable `team_registration` link. Replace password
verification with a separate `player_login_links` row per Player. Each token is
32 cryptographically random bytes (256 bits), encoded as 43 base64url characters;
D1 stores only SHA-256 hashes. High-entropy tokens do not require password hashing.
No password, passkey, external authentication provider, paid plan, or email service
is required. Outbound email code and bindings are removed. Legacy email issuance,
email invitations, and notification opt-in APIs are retired; updates remain in-app.
Existing email values are not erased as part of an authentication migration. New
accounts use a generated `.invalid` placeholder solely for the existing NOT NULL
legacy column; no email address is requested or collected.

`0007_player_login_links.sql` adds one table and an index for rate-counter cleanup.
It does not rewrite or delete existing users, credentials, sessions, profiles,
workouts, points, or awards. Old password hashes remain inert for rollback; no
application route computes or verifies passwords. Keep `0006_team_accounts.sql`
unchanged and apply it first if it is still pending. Schema, snapshot, and migration
journal must remain synchronized.

Existing signed-in Players choose **You → Account & security → Create personal
login link**. This attaches access to the same user and preserves all training.
Signed-out password/legacy Players ask a coach/admin for a replacement link; do
not register them again. Existing sessions keep working until expiry, logout,
revocation, deactivation, or role change. No automatic raw token backfill: raw
links are intentionally unrecoverable from D1 hashes.

## Player flow

1. An administrator creates the reusable link in **Club menu → Registration**.
   Save/share the complete `/join#token=...` link with the team.
2. Each Player opens that link, enters name, playing group, and position, and
   chooses **Create player account**. Role/status are set by the server.
3. The Player is signed in immediately. A save screen shows their unique
   `/player-login#token=...` link once, with copy/share/QR controls. Save it privately,
   then continue to the dashboard. The team link never authenticates an account.
4. Open the saved personal link on another device and choose **Sign in**. The link
   is reusable until revoked/replaced. It has no scheduled expiry. Sessions use
   the existing HttpOnly, Secure-on-HTTPS, SameSite=Lax cookie for 180 days and
   renew when fewer than 90 days remain. Clearing cookies/private browsing still
   requires the personal link. Logging out ends only that device's session.
5. A Player can replace their link in You. The previous link and all older sessions
   are revoked; the current device receives a fresh session. The raw link cannot
   be displayed again after leaving the page. Losing it requires replacement.

Anyone holding a personal link can act as that Player. Keep it private; do not
post it to the team group. This explicit bearer-link tradeoff suits this team's
low-sensitivity tracker. Registration links and personal links have distinct
routes, tables, and authorization checks. Fragments are captured into memory and
removed from the address bar/history, including when a replacement is opened on
the same page. Tokens travel only in POST bodies, never new URL paths/query strings,
audit payloads, or application logs. Never record token screens or request bodies.
A sign-in confirmation prevents automatic redemption by simple link previews.

## Recovery and staff boundaries

A coach or administrator first verifies the Player's identity through a known team
contact or in person. In **Members**, choose **Replace login link for …**, copy the
new link, and share it privately. **Revoke login link for …** disables access until
a replacement is issued. Both operations revoke all that Player's sessions and
outstanding legacy sign-in/reset links. No workouts or points change.

Recovery endpoints accept active Player targets only. Players cannot recover
other players; coaches cannot recover staff or manage registration. Staff do not
receive reusable Player links. Administrator-issued, single-use 15-minute staff
sign-in links and admin-only role invitations remain separate. Setup still requires
the operator's bootstrap secret and closes after the first administrator. Existing
already-issued staff magic links remain usable until their original expiry;
no new email links can be issued. Legacy email invitation redemption is retired.

Before rollout keep at least two trusted staff sessions/access paths. Role changes
revoke that user's Player link, sessions, and outstanding sign-in/reset links.
An admin must issue fresh staff access after promotion; a Player link can never
become a staff credential. Deactivation revokes access and reactivation does not
revive old links. Workout create/edit/delete and account/profile endpoints retain
their server-side ownership and role checks; public boards retain intended visibility.

## Abuse controls and Free budgets

New auth JSON bodies are limited to 8 KiB. Origin/Sec-Fetch-Site checks, no-store,
no-referrer and CSP remain. Atomic D1 counters allow 60 player logins/IP/15 minutes,
60 registrations/IP/hour, 200 registrations/team-link/hour, 60 registration option
checks/IP/15 minutes, and 20 link management operations/actor/15 minutes. Rejected
requests return 429 and Retry-After. Counter identities are hashed; expired counters
are deleted after 24 hours using an indexed timestamp. Shared squad Wi-Fi can hit
the per-IP limit; wait for its window or use another connection. Staff link creation
and legacy redemption retain their existing bounded limits.

The runtime uses Web Crypto random generation and SHA-256 on short inputs, indexed
D1 lookups, and small batches. There is no scrypt or other intentional CPU work,
no external auth service, and no paid-only resource. The Free quotas still apply:
Workers 100,000 requests/day and 10 ms CPU/request; D1 Free 5 million rows read/day,
100,000 rows written/day, 5 GB account storage (500 MB/database). Counter/session
writes count toward D1 limits. Free is a hosting target, not an unlimited capacity
promise. Avoid retry loops and large load tests. Track CPU and D1 rows after rollout.

The actual development Worker has NOT been benchmarked with this code: deployment
approval is required first. Local wall-clock timing cannot certify Workers CPU.
Do not claim the 10 ms acceptance gate passed until the measurements below exist.

## Development-only deployment plan — requires explicit approval

1. Review/merge the approved PR, record the exact SHA, and rerun `npm ci`,
   `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`, and
   `PW_BROWSER=webkit npx playwright test e2e/team-rollout.spec.ts`.
   Install official Playwright browsers/dependencies as needed.
2. Confirm Cloudflare identity and the existing `blackthorn-rugby-dev` Worker and
   `blackthorn-rugby-dev` D1 database. Verify its UUID differs from production.
   Confirm Free-compatible settings, `EMAIL_PROVIDER=none`, the dev APP_ORIGIN,
   no email bindings, no paid resources, and log query-string redaction. Do not
   alter billing or production settings. Wrangler credentials are currently missing
   in this workspace; configure them privately in environment settings.
3. Back up only development D1, save its bookmark/export and checksum, and verify
   it can restore locally. Do not copy production data or credentials. Keep trusted
   admin access and do not run setup over an existing club.
4. In the local `[env.dev]` block only, set the verified dev DB UUID; do not commit
   the real ID. From `apps/api`, always use `--env dev` for remote commands:
   ```sh
   npx wrangler d1 migrations list blackthorn-rugby-dev --env dev --remote
   npx wrangler d1 migrations apply blackthorn-rugby-dev --env dev --remote
   npx wrangler deploy --env dev --dry-run
   npx wrangler deploy --env dev
   ```
   Apply only pending migrations: the previously inspected dev database still
   needs 0006, followed by 0007; re-check instead of assuming. Review binding output
   before deployment. Never omit `--env dev` or use the top-level production DB.
5. Record the dev URL, deployment/version ID, binding output and migration results.
   Verify no production resource was mutated. All acceptance accounts must be
   synthetic; do not share development registration links with the real squad.
6. Create two synthetic Players through the same registration link. Verify distinct
   personal links; team token cannot log in; personal token cannot register;
   repeated/multi-device login; refresh/new visits; logout; coach/admin recovery;
   revocation; role changes; deactivation; cross-player access denial; workout
   create/edit/delete; separated boards and unchanged profile statistics. Confirm
   an existing synthetic account can attach a link without a new user/profile.

## Actual development CPU acceptance gate

Use the existing development Worker on Free, with invocation logs enabled and
query strings redacted. Do not deploy a benchmark Worker or change production.
Keep exactly the two synthetic personal URLs in an ignored private file such as
`.dev-auth-input.json`, mode 0600: `{ "personalLinks": ["…", "…"] }`.
After deployment approval, from repository root:

```sh
RUN_DEV_AUTH_BENCHMARK=approved DEV_AUTH_INPUT=.dev-auth-input.json node scripts/benchmark-dev-auth.mjs
```

The script is pinned to the exact development URL, rejects registration/other-host
links, prints no secrets, sends 30 valid and 5 invalid logins, and reports wall-time
p50/p95/max at concurrency 1, 2, 4, and 8. It does not measure CPU. Start with a quiet
15-minute rate window. A 429 is a failed benchmark run to investigate, not permission
to disable limits. Revoke both synthetic links afterward to remove their sessions.

For the recorded UTC interval, use **Workers & Pages → blackthorn-rugby-dev → Logs**
and the query builder to export invocation CPU time, wall time, outcome, request
path, and deployed version for `/api/auth/login`. Also capture registration,
link rotation, `/api/me` session renewal, and logout invocations from the smoke test.
Attach token-free evidence to the PR: sample counts, p50/p95/max CPU and wall time,
HTTP statuses, exceededCpu/resource errors, concurrency and D1 rows read/written.
Require all sampled auth invocations below 10 ms CPU, no CPU/resource errors, correct
responses and isolation, and adequate headroom (target p95 at or below 5 ms). Repeat
cold and warm samples without exceeding Free quotas. If it fails, profile and fix
the path, rerun tests and benchmark on dev; do not weaken token entropy, raise the
plan, or declare rollout successful. No actual Worker measurements are available yet.

References: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[invocation CPU/wall timing](https://developers.cloudflare.com/changelog/post/2025-04-09-workers-timing/).

## Rollback and mobile verification

Rollback the application to its prior version while retaining additive tables and
all training data. Old password users can use their preserved credentials if the
old application is restored. Players created by this PR have no passwords: keep
trusted admin access and use the prior legacy admin-issued sign-in path for those
accounts during rollback. Never drop tables, clear credentials, or reset D1.

The safe-area layout, focus/scroll behavior, modal trapping, compact cards, scoring
estimates, duplicate-workout prevention, latest-filter leaderboard behavior, and
profile statistics from PR #3 remain. Local Chromium/WebKit tests cover mobile
widths, landscape, simulated insets and accessibility. Physical iPhone Safari
keyboard/collapsing-toolbar behavior still needs a device check after approval.

## Local validation for this PR

- Workspace type checks, 71 unit/integration tests, and the React build passed.
- All 12 Chromium end-to-end tests and all 3 WebKit rollout tests passed.
- Development Wrangler packaging passed with D1/assets only and email disabled.
- Drizzle regeneration reports no schema changes.
- Applying 0006 and 0007 to a local restore of the development backup preserved every pre-existing column value across 25 existing tables; SQLite integrity check passed.
- WebKit used official Debian libraries extracted into a workspace-local browser copy. Actual browser launch succeeded; only its system-library-cache preflight was skipped.
- No remote migration, deployment, benchmark, production change, or real account creation occurred. Actual development CPU/latency/concurrency acceptance and physical iPhone checks remain pending approval.
