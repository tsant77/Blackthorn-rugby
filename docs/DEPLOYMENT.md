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

## Secrets

Phase 1 reads no secrets. When Phase 2 adds sessions, put secrets with Wrangler, not in git:

```bash
npx wrangler secret put SESSION_SECRET
```

Do not pass the secret value as a shell argument that lands in history. Wrangler prompts, or you can pipe it on stdin. Local development uses `apps/api/.dev.vars`, which is gitignored.

There is no `ADMIN_PASSWORD` or shared team code in this design. Access is by invitation.

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
