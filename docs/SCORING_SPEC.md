# Fitness scoring specification

The current specification and rollout policy are in
[Fitness scoring rollout](FITNESS_SCORING_ROLLOUT.md).

Recommended defaults are 12/11/10/10/9/9/8/8/4 points per ten minutes for Sprint/HIIT,
Rugby, Running, Circuit, Rowing, Weights, Basketball, Football, and Walking/recovery.
Intensity weights are 0.75/1.00/1.25/1.40. Workout cap 60; daily workout cap 100.
Weekly consistency awards only the highest qualifying +5/+8/+10 tier for 3/4/5
separate training days. Existing published v1 records keep their legacy rates.

Use integer tenths and hundredths throughout, server-side calculation only,
append-only ledger corrections, immutable version references, live transactional
daily caps, and atomic weekly deltas. The old formula remains in `legacyRule()`
solely for historical compatibility and regression tests. New defaults do not
silently replace the club's active configuration: an administrator must preview
and publish the effective date through Scoring Settings.
