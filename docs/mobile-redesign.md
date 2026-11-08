# Mobile performance redesign

This feature branches from `cursor/blackthorn-workout-tracker-7301` and targets that branch for review. No deployment is part of this change.

## Changed frontend

- `apps/web/src/components/Shell.tsx`: compact crest header, native modal club menu with Escape, focus return, role-based links, and four primary bottom tabs.
- `apps/web/src/pages/LogPage.tsx`: icon activity cards, duration presets and numeric custom duration, styled date and intensity controls, conditional distance, optional multiline notes, save feedback, session cards, and retained editing/deletion. Delete errors now surface in the form.
- `apps/web/src/pages/HomePage.tsx`: personalized weekly performance card, monthly/season points and session totals, streak, weekly training progress, activity breakdown, recent sessions from the existing workouts API, and quick logging.
- `apps/web/src/pages/BoardPage.tsx` and `ProfilePage.tsx`: consistent athletic headings and leaderboard cards; existing filters and profile controls retained.
- `apps/web/src/styles/tokens.css`: shared forest/charcoal surfaces, gold selection states, touch targets, card shapes, restrained motion, reduced-motion support, and safe-area spacing. Shared control styles also apply to secondary pages.
- `apps/web/index.html`: viewport safe-area support.

Authentication, role checks, API routes and payloads, scoring, D1 schema, and backend code are unchanged. Dashboard metrics come from the existing dashboard and workouts responses; no targets or derived performance claims are added.

## Validation

- Workspace TypeScript checks.
- 67 Vitest unit/integration tests across API, web, database, and scoring.
- Production Vite build.
- Playwright regression coverage for authentication/onboarding, recovery links, scoring/logging, dashboard, moderation, engagement, and accessibility.
- New mobile test exercises admin/player menu permissions, Escape/focus return, activity distance visibility, duration presets, save/edit/delete, axe scans, and 320px horizontal overflow.

## Screenshots

Captured with the local Worker/D1 test environment and synthetic test accounts at 390px wide:

| Home | Workout logging | Leaderboard | Profile |
| --- | --- | --- | --- |
| [Home](screenshots/mobile-redesign/home.png) | [Log](screenshots/mobile-redesign/log.png) | [Board](screenshots/mobile-redesign/board.png) | [Profile](screenshots/mobile-redesign/profile.png) |

Full-page captures include the fixed bottom navigation at the viewport position. Physical iPhone safe-area behavior should also be reviewed on-device before release.
