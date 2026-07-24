# K Brain v3 calibration decision

Decision date: 2026-07-24

The production v2 sample contained 72 graded starts across July 16, 19, 22,
and 23. Its mean projection was 4.776 K against 5.222 actual K:

- Bias: -0.446 K
- RMSE: 2.227
- Brier across the tracked half-strike lines: 0.13677
- Best Brier and RMSE scale: 1.085

The engine is moving from calibration `0.86` to `0.903`, a capped 1.05 step.
On the same held-out rows that produces:

- Bias: -0.207 K
- RMSE: 2.195
- Brier: 0.13482

The full 1.085 optimum is not deployed because v3 also replaces the
full-active-roster opponent proxy with a confirmed/projected nine-man lineup.
Any remaining scale change must be supported by final-pregame v3 results.

`recommendKCalibration()` enforces the reusable promotion guard: at least 60
starts, at least three dates, Brier/RMSE direction agreement, material mean
bias, improvement on both objectives, and a maximum five-percent change per
promotion.
