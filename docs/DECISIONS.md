# Owner decisions

Recorded 8 November 2026. These replace the Phase 1 open questions.

| # | Decision |
| --- | --- |
| 1 | Sign-in is an email magic link. There are no passwords. |
| 2 | One club. Groups are Forwards and Backs. Positions are the standard XV list, seeded as club config. Lock is one position (shirts 4 and 5 share it). Wings are Left Wing and Right Wing. |
| 3 | The offseason runs from 8 November 2026 through 30 April 2027. Every board uses America/New_York. |
| 4 | Updated after Phase 2. Identical same-day workouts all count. The engine does not flag duplicates or overlaps. Session, daily, and weekly load caps are the only limits. A repeated submit of the same form is still idempotent. |
| 5 | The player or a coach can set injury status. |
| 6 | A submitted workout counts on the leaderboard immediately. A coach can later reject or void it, which posts a reversing ledger row and an audit event. That moderation UI is Phase 5. |
| 7 | Caps stay at 15 points per session, 30 points per day, and 600 weighted minutes across any 7 civil days. |
| 8 | Distance is shown in miles. The database stores meters. |
| 9 | No photo uploads this offseason. R2 is not bound. |

The first admin is not seeded. Set the `BOOTSTRAP_ADMIN_EMAIL` secret. The first magic-link request for that address creates the admin membership if the club has none. After that, the secret does nothing.
