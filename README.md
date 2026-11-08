# Blackthorn Rugby — Offseason Performance Platform

Phase 1 of 7 for Blackthorn Rugby Club. This repo holds the product requirements, the D1 schema, the scoring engine, and the design system. Login, workout screens, and admin tools are later phases.

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
| `apps/web` | Vite + React specimen for the tokens |
| `apps/api` | Hono Worker shell (`GET /health` only) |

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

## Open questions for the owner

1. Invite auth: magic link, or a one-time link that sets a password?
2. Positions and groups. Suggested, not seeded: forwards and backs, plus the standard XV positions. Are youth positions different, and are senior and youth one club or two?
3. Offseason start and end for this cycle, and is `America/New_York` correct for every board?
4. May a player log two identical sessions the same day if they enter different start times? The engine allows that and blocks the no-time double submit.
5. Who can set injury status, the player, the coach, or both? The default limited policy scores nothing until a coach lists easy cleared types.
6. Should submitted sessions count on the board immediately (current spec) or only after a coach approves them?
7. Are the default caps right: 15 points per session, 30 per day, 600 weighted minutes per 7 days?
8. Show distance in miles or kilometers? The engine stores meters.
9. Are workout photos in scope this offseason, or is R2 staying off?

## Not in this phase

Product pages, real authentication, leaderboard queries, admin export, the service worker, and any deploy. See `docs/DEPLOYMENT.md` before the first `wrangler deploy`.
