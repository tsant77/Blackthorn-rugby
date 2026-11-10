# Deployment

An operator runs these steps with their own Cloudflare API token. This repository does not deploy, and it does not contain a token, an account id, or a database id.

The club has no mail domain. Launch on the account's `workers.dev` hostname. Email stays off.

## What you need

- Node.js 22 or newer
- A Cloudflare account
- An API token with Workers Scripts edit, D1 edit, and Workers Tail read. Create it in the Cloudflare dashboard. Do not commit it.

Export it only in the operator's shell:

```bash
export CLOUDFLARE_API_TOKEN="paste-the-token-here"
```

## 1. Install and check

From the repo root:

```bash
npm install
npm test
npm run typecheck
npm run build
```

## 2. Create the database

```bash
cd apps/api
npx wrangler d1 create blackthorn-rugby
```

Copy the printed `database_id` into `apps/api/wrangler.toml`, replacing `00000000-0000-0000-0000-000000000000`. Do not commit a real id if this repo is public; the operator can keep that change locally or in a private fork.

## 3. Apply migrations

From `apps/api`:

```bash
npx wrangler d1 migrations apply blackthorn-rugby --remote
npx wrangler d1 migrations list blackthorn-rugby --remote
```

That applies every file in `packages/db/migrations`, including the append-only ledger triggers and the club seed. It does not create people.

Take a backup before any later migration that rewrites rows:

```bash
npx wrangler d1 export blackthorn-rugby --remote --output "$HOME/blackthorn-rugby.sql"
```

Keep that file outside git.

## 4. Configure the Worker

Generate a long random setup token locally. Do not put it in a file in the repo.

```bash
npx wrangler secret put BOOTSTRAP_TOKEN
```

The workers.dev hostname is assigned by Cloudflare as `https://blackthorn-rugby.<account-subdomain>.workers.dev`. After the first deploy you can read it from the dashboard or `npx wrangler deployments status`. Set the public origin to that URL with no trailing slash:

```bash
npx wrangler secret put APP_ORIGIN
```

`APP_ORIGIN` is not really a secret, but a secret keeps it out of git. You can instead add it under `[vars]` in a private copy of `wrangler.toml`:

```toml
[vars]
APP_ORIGIN = "https://blackthorn-rugby.<account-subdomain>.workers.dev"
EMAIL_PROVIDER = "none"
```

`EMAIL_PROVIDER=none` is the launch default. Leave `EMAIL_FROM` unset. Do not set `EMAIL_PROVIDER` to `console` on the deployed worker. `console` stores message bodies and exposes `GET /api/dev/mailbox`.

Optional later, only after a sending domain exists:

```bash
npx wrangler secret put EMAIL_FROM
```

Then set `EMAIL_PROVIDER` to `cloudflare`. The `EMAIL` binding is already named in `wrangler.toml`. Do not set `remote = true` on that binding.

A second worker for a dress rehearsal uses `[env.dev]` and does not inherit the top-level bindings. Create `blackthorn-rugby-dev` with `wrangler d1 create`, put that id in the env block, then:

```bash
npx wrangler deploy --env dev
```

Production is the top-level config: `npx wrangler deploy`.

## 5. Deploy

From `apps/api`:

```bash
npx wrangler deploy
```

The cron `0 12 * * *` is enabled. That is 07:00 EST / 08:00 EDT. It sends challenge start and end notices and, on Mondays, the weekly recap. Recap email is sent only when a person has opted in. With email off, the recap is in-app only.

Confirm:

```bash
npx wrangler deployments status
npx wrangler tail
```

`tail` streams the Worker logs. Observability logs and traces are already enabled in `wrangler.toml`.

## 6. Create the first admin

Open `https://blackthorn-rugby.<account-subdomain>.workers.dev/setup`.

Enter `BOOTSTRAP_TOKEN` and a name. That creates the admin session and disables setup. A second visit fails even if the secret is still set.

Then delete the secret:

```bash
npx wrangler secret delete BOOTSTRAP_TOKEN
```

The admin creates invite links in the app and copies them into a text or the team chat.

## 7. Rollback

```bash
npx wrangler rollback
```

Rollback restores the previous Worker version. It does not roll back D1. Export the database first if a migration is destructive.

## Local development

```bash
npm install
npm test
npm run dev --workspace @blackthorn/web
npm run dev --workspace @blackthorn/api
```

Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` (gitignored). For local email capture set `EMAIL_PROVIDER=console`. For the launch path set `EMAIL_PROVIDER=none` and `BOOTSTRAP_TOKEN` to any local string.

Apply migrations locally from `apps/api`:

```bash
npx wrangler d1 migrations apply blackthorn-rugby --local
```

## Next migration

Edit `packages/db/src/schema.ts`, then from the repo root:

```bash
npm run db:generate
```

Commit the SQL and the Drizzle snapshot. Do not regenerate `0000` by hand. Leave `0001_append_only.sql` in place.

## Backups and export

- Database: `npx wrangler d1 export blackthorn-rugby --remote --output "$HOME/blackthorn-rugby.sql"`
- Workouts and points: a coach or admin downloads CSV from Scoring (`GET /api/export/workouts.csv`) while signed in.

Photos are out of scope. There is no R2 binding.
