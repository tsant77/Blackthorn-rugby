# Team registration and mobile rollout

## Review and deployment boundary

Source branch: `feature/team-registration-mobile-refinement`, based on
`cursor/blackthorn-workout-tracker-7301` including merged PR #2.
This change does not merge or deploy anything, run remote migrations, touch either
live database, or create real team accounts. Existing dev preview remains unchanged.

## Share one permanent registration link

1. Sign in as an administrator using the existing administrative sign-in path.
2. Open Club menu → Registration.
3. Choose **Create registration link**.
4. Copy **Team registration link** and save it somewhere only club administrators can access.
5. Paste the complete URL (including `#token=...`) into the team WhatsApp group.
6. Each player opens it, enters full name, unique username, password twice, playing group,
   and rugby position. The server validates the position/group relationship, assigns Player,
   creates the profile, and signs the player into their dashboard immediately.

The URL has the form `https://<app>/join#token=<random-token>`. A URL fragment is
intentionally used instead of a path/query token: the browser does not send it to
Cloudflare's HTTP access logs or in the Referer header. The page captures it in memory
and removes it from browser history. Reloading the form requires reopening the original
shared URL. There is no analytics integration.

The link supports unlimited separate player registrations and has no expiry by default.
The data model also supports an expiry, which the server always enforces. Disable registrations
to pause enrollment; enabling restores the same URL. **Rotate registration link** immediately
invalidates the previous URL without changing any accounts, sessions, or training history.
A rotation opens registration again.

Only the token's SHA-256 hash is retained on the server. The raw URL is shown only when
created/rotated and is not recoverable later. Save it when created; if lost, rotate and
share the replacement. Any member with the link can forward it; possession intentionally
allows Player registration but never administrative privileges.

The Registration page shows recently credentialed players. Members retains all existing
administration, including deactivation, role management, positions, and availability.
Deactivation now revokes all sessions and outstanding sign-in/reset links. Reactivation
requires a fresh login; it does not revive old sessions.

## Returning players and existing accounts

- Username/password sign-in is at **/login**, on any device. No email is collected.
- Usernames are ASCII, normalized to lowercase, 3–30 characters, using letters, digits,
  dots, underscores, or hyphens. Passwords are 12–128 characters, allow spaces/paste and
  password managers, and have no forced composition rules.
- Existing accounts: sign in using the saved administrative/invitation/device link,
  then **You → Account & security → Set up username & password**.
  This attaches credentials to the same user and preserves their profile, membership,
  workouts, ledger, awards, and history. Older sessions and unused sign-in links are
  invalidated, then a fresh session is created on the current device.
- If an existing player has lost access, an admin can issue a reset link even if that
  player has not yet established credentials. The reset form asks them to select a username.
- Credentials are never automatically assigned. Do not register an existing player
  again through the team link; migrate the existing account.
- Existing link and invitation APIs remain for migration and administrative access.
  Coaches may issue legacy device links for unmigrated players, but only admins can
  issue someone else's sign-in link once that account has password credentials.
- New account screens and the invitation/profile UI have no email field or notification
  dependency. The legacy optional email backend is preserved for compatibility; leave
  `EMAIL_PROVIDER=none` in every rollout environment.

## Administrator-assisted recovery

1. Verify the player's identity outside the application (in person or your known team contact).
2. Go to Members, locate the active player, and choose their **Password reset link** button.
3. Copy the newly shown link and share it privately with that player.
4. The player opens it within 15 minutes, chooses a new password twice, and signs in normally.

Only an active administrator can mint a reset for an active Player account. Coaches and
players receive 403. The token has 256 bits of randomness, is stored hashed, expires after
15 minutes, and is single-use. Creating another reset supersedes older reset links.
Reset completion atomically claims the token, updates credentials, revokes existing
sessions and legacy sign-in links, and records an audit event. It does not automatically
sign in whoever holds the browser. Existing username is retained; a legacy user without
one chooses one. Existing passwords cannot be retrieved or revealed. Reset links are
returned only at creation; lists/audits do not expose them.

Admin/coach self-recovery continues to use the preserved administrative access workflow.
Keep an additional trusted administrative access path before rollout; the Player reset
endpoint deliberately cannot reset an administrator.

## Additive migration

`packages/db/migrations/0006_team_accounts.sql`:

- Adds nullable `credentials.username` and a case-insensitive UNIQUE index.
  Existing credential rows are retained; multiple NULL usernames remain valid.
- Adds `team_registration`, one registration configuration per club with a token hash,
  enabled flag, optional expiry, and creator/timestamps.
- Adds `password_resets`, with token hash, target, expiry, single-use claim and audit ownership.
- Adds `auth_limits` for atomic fixed-window attempt counters.
- No existing user/workout/ledger/award rows are rewritten or deleted.
- Drizzle schema, generated SQL, migration journal and snapshot are synchronized.
  A second generation reports no schema changes. Wrangler applies the additive SQL file.

Migration rollback should be application rollback with these additive tables retained;
do not drop tables or clear credentials to undo a frontend deployment.

## Security review

- **Passwords:** Workers-supported native `node:crypto.scrypt`; N=32768, r=8, p=3,
  32-byte output, random 32-byte per-password salt, 64 MiB max allocation.
  This matches OWASP's scrypt alternative work factors. A versioned encoding stores
  the algorithm, work factor, salt, and hash. Passwords are neither logged nor stored
  plaintext/encrypted. Verification uses `timingSafeEqual`; absent/disabled accounts
  perform dummy verification with the same work factor and generic 401 errors.
- **Sessions:** existing 180-day HttpOnly, SameSite=Lax cookies, Secure on HTTPS,
  renewed when fewer than 90 days remain. Authentication always issues a new random session instead of adopting an incoming cookie;
  a previous session for that same user is revoked. Legacy invitation redemption preserves
  an administrator's other-account session for the existing migration workflow. Session IDs are random and hashed in D1.
  Password login checks the verified hash again in the session insertion transaction,
  preventing a concurrent password reset from granting a session with old credentials.
- **Authorization:** registration SQL hardcodes Player/active and validates the club's
  position/group relationship; arbitrary role, status, and points fields are ignored.
  Admin endpoints enforce authorization server-side, independently of navigation.
  Existing workout scoring/role guards and ledger immutability remain unchanged.
- **Transactions:** account, credentials, membership and profile are created in one batch.
  The current registration token/enabled/expiry are checked inside that transaction.
  Password reset claiming and all credential/session changes are one atomic batch.
  Duplicate usernames cannot leave orphan accounts.
- **Throttling:** atomic D1 UPSERT counters limit login to 60/IP and 15/username per
  15 minutes (including distributed guesses), registration to 60/IP/hour and 200/team-link/hour, link checks
  to 60/IP/15 minutes, reset attempts to 10/IP/15 minutes, and privileged reset/link
  management to 20/actor/15 minutes. Bucket identities are SHA-256 hashes, not raw IPs
  or usernames. Old buckets are deleted after 24 hours. Requests return 429 and
  Retry-After. A per-account throttle can temporarily deny a legitimate player under
  a targeted attack; the window is bounded. The registration limit allows a full squad on shared Wi-Fi; unusually large shared networks
  may need to use cellular/different networks or wait.
- **CSRF/XSS/injection:** existing origin and Sec-Fetch-Site checks, SameSite cookies,
  CSP, and parameterized SQL remain. New auth JSON payloads are limited to 8 KiB.
  React renders names/notes as text. Responses use no-store and no-referrer.
- **Token logging:** new registration/reset secrets use fragments and POST bodies,
  never URL paths/query strings, audit payloads or application logs. Wrangler query
  redaction is enabled for legacy query-based links as well. No request-body logging,
  analytics, or session replay should be added on auth pages. Avoid capturing tokens
  in ad-hoc browser recordings or support screenshots.
- **Data isolation:** all automated tests use an isolated local SQLite/D1 database with
  synthetic accounts. This work never connects to production data.
- **Preserved rules:** no scoring formula/cap/moderation/tie-break or achievement
  eligibility changes. Badge progress uses the same stats and criteria as awards;
  earned badges remain earned after moderation. Estimates use the active scoring
  formula and session cap, labeled before daily caps/training limits; final award is
  still authoritative on the server.

## Mobile changes and verification scope

The application frame owns top/left/right safe-area padding; the header no longer
independently owns a second inset. Viewport-fit=cover is preserved. Route changes reset
scroll and focus the new main landmark. Dialogs use native modal focus trapping and
a safe-area/dynamic-viewport height, freeze background scroll, restore scroll when
closing on the same route, and start at the top on menu navigation.

The header/card/spacing are more compact, inactive tabs have higher contrast, custom
duration placeholder uses body-sized text, workout actions have a separate row, dates
are human-readable, and leaderboard rows use a three-column grid with compact labeled
movement indicators and PTS. Profile identity, statistics and badge cards retain existing data.

Browser tests simulate top/bottom insets and exercise 320px, 375px and landscape layouts.
WebKit is the Safari engine, but Linux WebKit cannot reproduce the physical iPhone
status bar or Safari's collapsing address toolbar/onscreen keyboard. Before release,
repeat navigation after scrolling, typing in notes/password, opening/closing the menu,
and rotating on a real iPhone Safari. Verify the last field and Save action scroll
above bottom navigation with both expanded and collapsed browser chrome. No model-specific
fixed offsets were added.

## Development deployment — only after explicit approval

The existing `blackthorn-rugby-dev` preview has not been updated by this PR. No deployment
or remote migration command below was run.

1. Verify the approved commit and back up the **development** database if retaining its
   synthetic state. Never copy production data or authentication secrets.
2. Use the existing `apps/api/wrangler.toml` `[env.dev]` block. Set only its
   `blackthorn-rugby-dev` database UUID locally; leave the top-level production binding unchanged.
   Keep real IDs and credentials uncommitted. Confirm `[env.dev.vars]` includes:
   `EMAIL_PROVIDER="none"` and the dev APP_ORIGIN.
3. Review the Cloudflare plan/CPU budget before deployment. Native scrypt uses ~32 MiB
   and intentionally substantial CPU (roughly hundreds of milliseconds locally).
   Workers Free's small CPU allowance may be insufficient. Use an appropriate Workers
   Paid CPU budget and load-test on dev before full-team rollout; do not weaken password
   hashing to fit an inadequate budget. The PR does not change billing or remote CPU limits.
4. Run checks from repository root:
   `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`.
   For Safari engine: `PW_BROWSER=webkit npx playwright test e2e/team-rollout.spec.ts`
   after installing the official browser and OS dependencies.
5. From `apps/api`, after checking account and environment:
   `npx wrangler d1 migrations list blackthorn-rugby-dev --env dev --remote`
   then `npx wrangler d1 migrations apply blackthorn-rugby-dev --env dev --remote`.
6. Review the dev-only binding output:
   `npx wrangler deploy --env dev --dry-run`.
7. Only with deployment approval:
   `npx wrangler deploy --env dev`.
   Verify it names **blackthorn-rugby-dev**, uses the distinct dev DB, and has email disabled.
   Never omit `--env dev`.
8. Keep the dev seed synthetic. Existing preview accounts can migrate via You; create
   new synthetic players through a registration link. Smoke login/register/reset,
   workout create/edit/delete, dashboard, board and profile. Verify production is unchanged.
9. After an approved production release, the real club administrator should generate
   the team URL inside that environment. Do not share a dev registration URL with the team.

## Screenshots and results

Screenshots use synthetic accounts and contain no raw registration/reset/session tokens.
The WebKit/Chromium folders are captured from local tests; full-page images show the fixed
bottom navigation at its viewport position.

- [Chromium registration](screenshots/team-rollout/chromium/registration.png)
- [Chromium home](screenshots/team-rollout/chromium/home.png)
- [Chromium logging](screenshots/team-rollout/chromium/log.png)
- [Chromium leaderboard](screenshots/team-rollout/chromium/board.png)
- [Chromium profile](screenshots/team-rollout/chromium/profile.png)

Validation completed locally:
- All workspace TypeScript checks passed.
- All 76 Vitest unit/integration tests passed (42 API, 2 web, 3 database, 29 scoring).
- Production React build passed.
- All 12 Chromium end-to-end tests passed.
- All 3 WebKit rollout tests passed, including registration/login/reset, migration, and delayed leaderboard responses.
- Axe accessibility scans passed within the browser tests.
- Wrangler dev packaging dry run passed; nothing uploaded.
- Drizzle regeneration reports no remaining schema changes.

WebKit was run with official Debian libraries extracted into the user-owned browser
cache because root installation is unavailable here. Its system-cache preflight was
skipped only after a real browser launch succeeded; the actual browser tests ran.

Safari-engine screenshots:
[Registration](screenshots/team-rollout/webkit/registration.png) ·
[Home](screenshots/team-rollout/webkit/home.png) ·
[Log](screenshots/team-rollout/webkit/log.png) ·
[Board](screenshots/team-rollout/webkit/board.png) ·
[Profile](screenshots/team-rollout/webkit/profile.png).

Runtime docs used:
[Workers crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/),
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
