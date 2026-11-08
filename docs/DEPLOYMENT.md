# Deployment

Not done in this phase, and not done by CI. The owner deploys from their own Cloudflare account. Do not commit account ids, API tokens, or passwords.

## What is already in the repo

- Worker config: `apps/api/wrangler.toml` (`name = "blackthorn-rugby"`, binding `DB`).
- Migrations: `packages/db/migrations`.
- Placeholder `database_id` of `00000000-0000-0000-0000-000000000000`. Replace it. Do not deploy against that value.

## First production database

From `apps/api`, after `npx wrangler login` with the owner's account:

```bash
npx wrangler d1 create blackthorn-rugby
```

Copy the returned `database_id` into `wrangler.toml`. Then:

```bash
npx wrangler d1 migrations apply blackthorn-rugby --remote
```

That applies both the generated schema and `0001_append_only.sql`.

Confirm the migration list:

```bash
npx wrangler d1 migrations list blackthorn-rugby --remote
```

## Secrets and email

There is no password and no shared team code. Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` for local development. That file is gitignored.

Production secrets and vars, from `apps/api`:

```bash
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
```

Set these as Wrangler vars (they are not secret, but they are environment-specific):

- `APP_ORIGIN` — public https origin, no trailing slash. Magic links are built from it.
- `EMAIL_FROM` — address on a domain onboarded to Cloudflare Email Service, for example `noreply@blackthornrugbyclub.com`.
- `EMAIL_PROVIDER` — omit it, or set `cloudflare`. Do not set `console` on the deployed worker. `console` stores message bodies in `dev_mailbox` and exposes `GET /api/dev/mailbox` so local tests can read links.

Email setup the owner must do once:

1. Onboard the sending domain in Cloudflare Email Service (SPF and DKIM). The Workers binding is `EMAIL` (`send_email` in `wrangler.toml`).
2. Set `EMAIL_FROM` to an address on that domain.
3. Set `BOOTSTRAP_ADMIN_EMAIL` to the first admin. Request a magic link for that address before anyone else is an admin. Later requests for that address are ordinary sign-ins.
4. Leave `remote` off the email binding in config. Turning on remote bindings during `wrangler dev` sends real mail.

Local `wrangler dev` with `EMAIL_PROVIDER=console` does not send mail. It logs a subject line and stores the body in D1 for the dev mailbox route.

Photos are out of scope. There is no R2 binding.

## Scheduled job

`src/index.ts` exports a `scheduled` handler. Once a day it publishes challenge start and end notices, archives a challenge the day after it ends, and on Monday sends each player last week's points. Email goes out only when that person opted in. The default is in-app only.

The cron is written in `apps/api/wrangler.toml` and left commented so a deploy does not start it by surprise. Uncomment it when the owner wants the job:

```toml
[triggers]
crons = ["0 12 * * *"]
```

12:00 UTC is 07:00 EST and 08:00 EDT. Opening the challenges page also applies start and end transitions, so a missed cron still catches up the next time someone looks. The weekly recap waits for the cron.

## Deploy and rollback

```bash
npx wrangler deploy
npx wrangler rollback
```

Rollback restores the previous Worker version. It does not roll back D1 rows. Take a backup before a destructive migration.

## Backups

```bash
npx wrangler d1 export blackthorn-rugby --remote --output blackthorn-rugby.sql
```

Keep that file outside the git repository. Export before applying a migration that rewrites data. The Phase 1 migration only creates empty tables.

## Local

```bash
npm install
npm test
npm run dev --workspace @blackthorn/web
npm run dev --workspace @blackthorn/api
```

Apply migrations locally with:

```bash
npx wrangler d1 migrations apply blackthorn-rugby --local
```

Run that from `apps/api` so Wrangler finds the config.

## Generating the next migration

Edit `packages/db/src/schema.ts`, then from the repo root:

```bash
npm run db:generate
```

Commit the new SQL and the Drizzle snapshot. Do not regenerate `0000` by hand. Leave `0001_append_only.sql` in place.
