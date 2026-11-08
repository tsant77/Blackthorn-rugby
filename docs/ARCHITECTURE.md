# Architecture

Phase 1 decides the shape. Later phases fill it in. Nothing here is deployed.

## Layout

```
apps/web     React, TypeScript, Vite, Tailwind v4, shadcn-ready
apps/api     Hono on a Cloudflare Worker (health check only)
packages/scoring   Pure scoring engine and its tests
packages/db        Drizzle schema and D1 SQL migrations
docs               Requirements, scoring spec, design system
```

npm workspaces. The web app does not import the scoring package yet. Phase 3's API will. The dependency direction is one way: `api` may depend on `db` and `scoring`; those two depend on neither app.

## Why the scoring engine is pure

Caps, injury, and overlap are easy to get wrong and easy to test if they do not touch D1. `scoreWorkout` takes a rule, an athlete, a clock, and the history the API already loaded. Tests cover the abuse cases without Miniflare. The Worker stays a thin permission and persistence layer.

## Why points are a ledger

The first sketch of this product recomputed points from raw minutes whenever a multiplier changed. That hides history. This spec stores raw inputs on `workouts` and awarded tenths on `point_transactions`, tagged with the rule version. A coach can see that a session grossed 36.0 and paid 15.0 because of the session cap. Editing or voiding inserts a reversal. Rows are not updated. Triggers in `0001_append_only.sql` reject updates and deletes on the ledger and on `audit_events`.

## Why Drizzle plus Wrangler migrations

The schema lives in `packages/db/src/schema.ts`. `drizzle-kit generate` writes SQL. Wrangler applies every `packages/db/migrations/*.sql` file, in order, with `wrangler d1 migrations apply`. Do not run `drizzle-kit migrate` against D1. The Drizzle journal is only there so the next generate can diff the schema. The hand-written trigger file is a Wrangler migration on purpose.

`club_id` is on every club-owned table. Handlers must set it from the membership, never from the client. Foreign keys use `ON DELETE RESTRICT` so a deactivate cannot cascade history away.

## Why the UI is charcoal

The club site is a sage Wix page with a gold-and-green crest. The product brief asks for a dark charcoal athletic tool and a restrained accent. The accent is the crest's gold (`#F2B10B`). Forest and sage stay in the wordmark and secondary actions. Details and contrast numbers are in `docs/DESIGN_SYSTEM.md`.

## Auth, files, and jobs

Sign-in is a magic link. `magic_links` and `invitations` store only a SHA-256 of the token. The session cookie is HttpOnly and holds a random token; the database stores its hash. `credentials` is unused. There are no passwords.

Mail goes through an `EmailProvider`. `console` writes the body to `dev_mailbox` for local tests. `cloudflare` calls the Workers `EMAIL` binding (`SendEmail.send`). Production must onboard a sending domain and set `EMAIL_FROM`. See `docs/DEPLOYMENT.md`.

R2 stays unbound this offseason.

R2 is in the data model (`media_objects`) and commented out of `wrangler.toml` so a deploy does not create a bucket by surprise.

Weekly load, leaderboards, and badge checks are request-time queries at this club's size (under 25 players). Challenge start and end notices also run when someone opens the challenges page. The daily cron is enabled in `wrangler.toml` for the operator's deploy. This repo does not run that deploy. See `docs/DEPLOYMENT.md`.

## Worker

`apps/api/wrangler.toml` names the worker `blackthorn-rugby`, binds D1 as `DB`, and sets observability logs and traces. `database_id` is a placeholder. There is no account id. The only route is `GET /health`.
