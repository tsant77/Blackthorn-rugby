# Blackthorn Rugby — Offseason Performance Platform

Phase 7 of 7 for Blackthorn Rugby Club. Sign-in is a link the club shares. Email is optional and off at launch. The operator deploy steps are in `docs/DEPLOYMENT.md`.

The club crest and colors come from [blackthornrugbyclub.com](https://www.blackthornrugbyclub.com). The app is a dark charcoal tool. Gold (`#F2B10B`) is the accent. The crest file is `apps/web/public/brand/logo.jpg`.

## Layout

| Path | What it is |
| --- | --- |
| `docs/PRODUCT_REQUIREMENTS.md` | Product spec and phase plan |
| `docs/SCORING_SPEC.md` | Versioned scoring rules |
| `docs/DESIGN_SYSTEM.md` | Tokens, type, spacing, component inventory |
| `docs/ARCHITECTURE.md` | Why the pieces are split this way |
| `docs/DEPLOYMENT.md` | How the owner will deploy later |
| `packages/scoring` | `scoreWorkout` and its tests |
| `packages/db` | Drizzle schema and SQL migrations |
| `docs/DECISIONS.md` | Owner answers from the Phase 1 review |
| `apps/web` | React app shell |
| `apps/api` | Hono Worker: magic links, invites, onboarding |

## Phase 1 acceptance

| Criterion | Status |
| --- | --- |
| Requirements written, with later phases called out | Done |
| Normalized schema and initial migration | Done |
| Scoring spec, engine interface, boundary and abuse tests | Done |
| Design tokens in the Tailwind theme, 8-point spacing, inventory | Done |
| No secrets, no Cloudflare account id | Done |
| CI typechecks, tests, and builds; it does not deploy | Done |

## Commands

```bash
npm install
npm test
npm run typecheck
npm run build
```

The web specimen:

```bash
npm run dev --workspace @blackthorn/web
```

## Phase 2 acceptance

| Criterion | Status |
| --- | --- |
| Shell with bottom nav, desktop layout, error boundary, loading and empty states | Done |
| Personal player login links and persistent sessions, no passwords | Done |
| Admin invitations and player onboarding onto a seeded XV | Done |
| Email-free registration and coach/admin-assisted link recovery | Done |
| Integration tests and Playwright invite → link → onboarding | Done |
| Mobile and desktop screenshots | `docs/screenshots/phase-2` |

Owner decisions are in `docs/DECISIONS.md`.

## Phase 5 acceptance

| Criterion | Status |
| --- | --- |
| Moderation queue with reject, void, and restore | Done |
| Void and reject post a ledger reversal and an audit event; the player sees the status and reason | Done |
| Member invite resend and revoke, role, deactivation, position, and availability | Done |
| New scoring versions take effect on a future date and do not rewrite past ledger rows | Done |
| Manual adjustments are ledger rows with a reason | Done |
| Offseason dates, filtered audit log, workout and points CSV | Done |
| Players receive 403 on coach and admin endpoints; coaches receive 403 on admin-only endpoints | Done |
| Playwright: coach void drops the board | Done |
| Mobile and desktop screenshots | `docs/screenshots/phase-5` |

## Phase 6 acceptance

| Criterion | Status |
| --- | --- |
| Badges for a first session, streaks, point totals, and activity variety, awarded once | Done |
| Coach challenges for a player or a group, with progress and a result | Done |
| In-app inbox for badges, review decisions, challenge start and end, and the weekly recap | Done |
| Email notices only after a person opts in | Done |
| Daily cron documented and left off until deploy | Done |
| Mobile and desktop screenshots | `docs/screenshots/phase-6` |

## Phase 7 acceptance

| Criterion | Status |
| --- | --- |
| Shareable invite, club join, and one-time recovery links | Done |
| 180-day sliding HttpOnly session, token hashes only | Done |
| One-time `BOOTSTRAP_TOKEN` setup | Done |
| Email optional and hidden when `EMAIL_PROVIDER=none` | Done |
| Authz, CSRF, cookie flags, CSP, rate limits, IDOR checks | Done |
| axe on login, home, and log | Done |
| Operator deploy runbook, cron enabled, service worker | Done |
| Mobile and desktop screenshots | `docs/screenshots/phase-7` |

## Still open

- Which address sends mail, once the club domain is on Cloudflare Email Service (`EMAIL_FROM`).
- Whether a badge should be taken away if a later void drops the player back under the milestone. It stays earned.
- Whether a challenge should add bonus points. It does not. It only tracks the target.

## Not in this phase

The service worker and any deploy. See `docs/DEPLOYMENT.md`.

Authentication and the approval-gated development rollout are documented in [Team rollout](docs/TEAM_ROLLOUT.md). The actual development Worker 10 ms CPU benchmark is pending deployment approval.

Fitness rates, Club Scoring Settings, weekly consistency, historical award preservation, training indicators, and the approval-gated development plan are documented in [Fitness scoring rollout](docs/FITNESS_SCORING_ROLLOUT.md). Scoring is a separate PR coordinated with the merged authentication change.
