# Blackthorn Rugby — Offseason Performance Platform

Phase 2 of 7 for Blackthorn Rugby Club. The shell, magic-link sign-in, invitations, and player onboarding are in place. Workout logging is next.

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
| Magic-link sessions, no passwords | Done |
| Admin invitations and player onboarding onto a seeded XV | Done |
| Console email provider and Cloudflare Email Service provider | Done |
| Integration tests and Playwright invite → link → onboarding | Done |
| Mobile and desktop screenshots | `docs/screenshots/phase-2` |

Owner decisions are in `docs/DECISIONS.md`.

## Still open

- Which address sends mail, once the club domain is on Cloudflare Email Service (`EMAIL_FROM`).
- Whether a coach who also plays should complete a player profile in this release. The invite role is a single role today.

## Not in this phase

Workout logging, leaderboard math, admin export, the service worker, and any deploy. See `docs/DEPLOYMENT.md`.
