# Product requirements

Status: Phase 7 of 7. Owner decisions are in `docs/DECISIONS.md`. Sign-in is a shared link. Email is optional. The production review is in this phase.

Product: Rugby Offseason Performance Platform for Blackthorn Rugby Club (Horsham, PA).

## Problem

Offseason training is invisible. Players do the work, coaches cannot see who is training, and a fair club competition needs rules that do not reward double-logging, junk numbers, or training through an injury.

## Users

| Role | What they need |
| --- | --- |
| Player | Join by invitation, log sessions, see points, history, and how they sit on the board. |
| Coach | Review sessions, set availability, run challenges, read participation. |
| Admin | Invite and deactivate people, assign positions and groups, publish scoring versions, export data. |

A coach who also trains has both a coach (or admin) membership and a player profile. Roles live on the membership, not on a global user flag.

The schema is multi-club. Version 1 is operated as one club. Youth and senior sides are an open question, not a second product.

## Phase plan

| Phase | Outcome | In this repository now |
| --- | --- | --- |
| 1 | Requirements, schema, scoring spec and engine, design system | Done |
| 2 | App shell, invitation auth, onboarding | Done |
| 3 | Workout logging wired to the scoring engine | Done |
| 4 | Dashboards, leaderboards, analytics | Done |
| 5 | Coach and admin tools, export, moderation | Done |
| 6 | Challenges, achievements, notifications | Done |
| 7 | Security, accessibility, and production readiness review | This phase |

## Functional requirements

Identifiers are stable. The phase column is when the behavior is implemented, not when it was specified.

| ID | Requirement | Phase |
| --- | --- | --- |
| FR-1 | An admin invites a person by email into a role: player, coach, or admin. The invite expires and is stored as a hash, not a raw token. | 2 |
| FR-2 | Accepting an invite creates a user (if needed) and one membership in that club. | 2 |
| FR-3 | Deactivating a membership keeps history and removes access. Rows are not hard-deleted. | 5 |
| FR-4 | Admins define positions and groups. Players have at most one position and one group. | 5 |
| FR-5 | Players log running, weight training, rowing, circuit training, basketball, rugby, and football. | 3 |
| FR-6 | The server scores the session. The client cannot submit points. | 1 engine, 3 API |
| FR-7 | Points follow the active scoring version. Old versions stay readable. | 1 spec, 5 editing |
| FR-8 | Session and daily caps, duplicate detection, overlap detection, injury holds, and the weekly load guard behave as in the scoring spec. | 1 engine, 3 API |
| FR-9 | A player sees weekly, monthly, offseason, and position-group leaderboards for their club only. | 4 |
| FR-10 | Personal records are derived from exercise loads. They are not a separate table in v1. | 4 |
| FR-11 | Coaches can approve, reject, or void a session. Rejection and void reverse the ledger. | 5 |
| FR-12 | Admins export workouts as CSV. | 5 |
| FR-13 | Challenges and achievements are club-scoped and awarded by the server. | 6 |
| FR-14 | In-app notifications exist for invites, review decisions, and achievements. | 6 |
| FR-15 | Every admin change writes an audit event. The audit log is append-only. | 5 |
| FR-16 | Every query is scoped by the caller's club membership. Clients do not choose the club id. | 2 onward |
| FR-17 | Photos are out of scope this offseason. The media table stays unused and R2 is not bound. | Deferred |

## Authorization

- Unauthenticated requests can reach the future login and invite-accept routes only.
- A player reads and writes their own sessions, subject to the scoring rules and the edit window defined with the logging API.
- A coach reads the club, reviews sessions, and updates injury status.
- An admin does everything a coach does, plus invites, deactivation, scoring versions, positions, groups, and export.
- Cross-club reads return not found, not an empty leak of another club's ids.

Rate limiting is required on invite acceptance and login. The `login_attempts` table is the store. Enforcement starts in Phase 2.

## Leaderboards

Boards sum `point_transactions` for sessions in `submitted` or `approved` status. `rejected` and `voided` sessions contribute nothing after their reversals.

Periods, in the club timezone:

- Week: Monday through Sunday.
- Month: the calendar month.
- Offseason: the active `competition_periods` row of kind `offseason`.
- Position group: the same periods, filtered by `player_profiles.group_id`.

Ties share a rank. The next rank skips (1, 1, 3).

Provisional scoring: a submitted session counts immediately. A rejection posts a reversal. Clubs that want approval first can be supported later by ignoring `submitted` in the sum. That switch is an open question; the default is immediate count.

## Non-goals for the first release

- Payments, public websites, or match fixtures.
- GPS tracking or wearable sync.
- A native app. The web app is a PWA. The manifest is in place; the service worker arrives with the shell.
- Seeding a roster. Coaches add real players after launch.
- Recomputing history silently when a multiplier changes.

## Phase 1 acceptance criteria

| # | Criterion | Result |
| --- | --- | --- |
| AC-1 | This PRD names roles, club isolation, the page set, and the phase each behavior lands in. | Met by this document and the page list below. |
| AC-2 | The Drizzle schema covers clubs, users, memberships, profiles, workouts, exercises, scoring versions, the points ledger, challenges, achievements, audit, and notifications, and the SQL migration creates those tables. | Met when `npm test` passes `@blackthorn/db`. |
| AC-3 | The scoring spec is versioned and covers caps, duplicates, overlaps, injury, and overtraining. | Met by `docs/SCORING_SPEC.md`. |
| AC-4 | `scoreWorkout` implements that spec, ignores client points, and its boundary tests pass. | Met when `npm test` passes `@blackthorn/scoring`. |
| AC-5 | Design tokens, type, 8-point spacing, and the component inventory are specified and implemented in the Tailwind theme. | Met by `docs/DESIGN_SYSTEM.md`, `tailwind.config.ts`, and `tokens.css`. |
| AC-6 | No secrets or Cloudflare account ids are committed. | Met. `database_id` is a placeholder zero UUID. |
| AC-7 | CI runs typecheck, unit tests, and the web build, and does not deploy. | Met by `.github/workflows/ci.yml`. |

## Pages (built later)

1. Login and invitation onboarding
2. Player dashboard
3. Log workout
4. Workout history and editing
5. Leaderboards
6. Player profile
7. Progress analytics
8. Team activity feed
9. Challenges and achievements
10. Admin dashboard
11. Player management
12. Scoring configuration

Phase 1 ships a design specimen at the web app root so the tokens can be reviewed. It is not one of these pages.

## Open questions

See the list in `README.md`. They block copy and policy, not the Phase 1 schema.
