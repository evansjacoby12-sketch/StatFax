# MLB model decision record

This document defines what production models currently do and which boundaries must not be silently crossed. Update it in the same commit as any production scoring-policy change.

## Shared rules

- Pregame identity is `date + gamePk + playerId` (or `gamePk` for games). Doubleheaders are separate games even when teams match.
- Started-game projections freeze their pregame values. Live facts may be displayed but do not rewrite the locked pregame recommendation.
- Missing data lowers coverage/confidence or blocks a call; it must not be replaced with invented evidence.
- Market prices are comparison inputs. They do not become the engine's predicted result.
- Historical promotion uses leakage-safe, date-ordered evaluation. A better Brier score alone is not enough when ranking lift/AUC or sample gates fail.
- AI narration never supplies a player, probability, score, grade, game call, or bet leg.

## HR engine

Authority: `src/sports/mlb/logic/ProbabilityEngine.js`, with the production pipeline in `server/fetch-slate.mjs`.

- Composite score: 45% batter quality, 30% matchup, 25% environment.
- Internal tiers: PRIME at 72+, STRONG at 52+, LEAN at 36+, otherwise SKIP. Display names may differ.
- PRIME has an absolute score floor and a game-normalized label cap. Overflow is demoted to STRONG; score and HR probability are not changed by the cap.
- The published HR probability is calibrated separately from the 0-100 rank score. Do not treat a grade as an event guarantee.
- Park/weather, hotness, and other post-process adjustments have explicit caps. Blast remains non-scoring unless its forward gate is deliberately promoted.
- The zone/contact collision can apply a capped HR-probability-only overlay after reliable zone evidence and hard-hit qualification. It must not mutate score or grade.
- Post-break/calendar-gap form decay, league power regime, ranking-health checks, and context-overlay lift control slate resilience. Weak regimes reduce PRIME/combo supply rather than manufacturing confidence.

AI external context has two paths:

1. The shadow ledger evaluates the hypothesis without changing production.
2. A manual production promotion, explicitly marked `gateOverride: true`, applies only the same source-backed, confidence-derived capped log-odds adjustment to `hrProbability`. It never changes score, grade, simulation input, or calibration input. The adjustment is idempotent and records the baseline and exact signal IDs.

The manual override is intentional despite the original sample gate. It must remain visible in artifacts and validators; do not describe it as fully evidence-promoted.

## K Brain

Authority: `src/sports/mlb/logic/kBrain.js`; current model version is 4.

- The primary output is one decimal projected strikeout count, not an outcome range.
- It combines lineup-level batter K tendencies with pitcher season/split/recent miss skill, projected batter-faced volume, pitch efficiency, third-time-through penalty, and park/umpire/weather context.
- The transparent baseline (`K/9 × IP/9 × opponent K% / league K%`) is a comparison/explanation, not a second competing projection.
- Book-line over probabilities are Poisson outputs around the canonical projected K.
- Lineup-aware selection and pregame identity must remain doubleheader-safe.
- Calibration changes require current-model held-out starts; do not tune from the old 45/183 aggregate record alone.

## Forecast V10: moneyline and totals

Authority: `src/sports/mlb/logic/gameProjection.js` and `gameMarketDecision.js`; current model version is 10.

- Team runs begin with opposing-starter expected runs over expected innings plus bullpen runs for the remainder, then apply lineup strength, park/weather, contextual matchup factors, and a small home-field run edge.
- Win probability is a logistic transform of projected run differential (slope 0.45). A one-run edge is roughly 61%, two runs roughly 71%, and three runs roughly 79% before rounding.
- Total pricing uses the independent Poisson scoring contract at the decimal projected total.
- Sportsbook no-vig probabilities and prices measure edge/expected ROI and market quality. They do not define the raw run projection.
- Game-market calls are PLAY, LEAN, or PASS. PLAY requires historical readiness, forward non-drift, edge, ROI, coverage, and at least two books. A raw PLAY is capped to LEAN while validation is not ready.
- PASS is directional model information, not a recommended bet.

Run lines are not a production market. Do not reintroduce them without a separately validated pricing and tracking contract.

## NRFI/YRFI first-inning layer

Authority: `src/sports/mlb/logic/firstInningProjection.js` on top of Forecast V10.

- Foundation: three-season MLB first-inning linescores with expanding-date walk-forward validation and sample shrinkage.
- Current teams: season/recent first-inning offense and allowance, strict recent-30 team form as evidence, plus starter first-inning samples.
- Pitcher micro layer: roughly 30-60-day lookback, previous-season blend when the current-season start sample is thin, first-inning FIP, first-time-through K/BB, and handedness-aware top-three lineup quality.
- Park, weather, lineup availability, and Forecast V10 contribute current-slate context.
- NRFI and YRFI probabilities are complementary and sum to 1.
- First-inning calls are STRONG, LEAN, or WATCH. WATCH is diagnostic unless the explicit prospective WATCH-NRFI promotion policy earns promotion from settled results.
- The rolling league-wide 30-day NRFI/YRFI regime is shadow-only until it proves stable Brier improvement.

## List Builder and BetLab

- List Builder filters already-computed batter evidence. AI translates words into visible criteria and may summarize aggregates; it does not score players.
- Curated parlay recipes use selected PRIME/STRONG candidates, pregame status, game separation, and tracked recipe evidence. Randomization may choose among qualified candidates but cannot bypass validity gates.
- BetLab combo strategies and NRFI/YRFI calls remain distinct from List Builder recipes.
- Ignore HR sportsbook prices where the strategy explicitly says to; never silently apply that rule to moneyline/totals pricing.

## Required proof for a production model change

1. State the hypothesis and exact fields changed.
2. Preserve a baseline and model version.
3. Run unit/data-contract tests.
4. Use date-ordered held-out or prospective outcomes; report sample, event count, dates, Brier/log loss, AUC/ranking lift where applicable, calibration, and tier/top-k results.
5. Add a rollback path and update this record.
6. Do not promote only because a recent anecdotal streak won.
