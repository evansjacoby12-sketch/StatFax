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

- Composite score: 52% batter quality, 30% matchup, 18% environment.
- Internal tiers: PRIME at 72+, STRONG at 52+, LEAN at 36+, otherwise SKIP. Display names may differ.
- PRIME has an absolute score floor and a game-normalized label cap. Overflow is demoted to STRONG; score and HR probability are not changed by the cap.
- The published HR probability is calibrated separately from the 0-100 rank score. Do not treat a grade as an event guarantee.
- Park/weather, hotness, and other post-process adjustments have explicit caps. Blast remains non-scoring unless its forward gate is deliberately promoted.
- The zone/contact collision can apply a capped HR-probability-only overlay after reliable zone evidence and hard-hit qualification. It must not mutate score or grade.
- Post-break/calendar-gap form decay, league power regime, ranking-health checks, and context-overlay lift control slate resilience. Weak regimes reduce PRIME/combo supply rather than manufacturing confidence.

### HR model v2 / probability pipeline v2 — 2026-08-07

- Every frozen pregame record carries `hrModelVersion`, `probabilityPipelineVersion`, the exact `publishedHRProbability`, and an auditable probability trace from raw simulation through calibration, power regime, zone delta, and publication. Forward Brier may use only exact-version, identity-safe, data-trusted, actually-played rows.
- The old headline Brier was in-sample because it re-mapped historical scores through the table fitted on those same outcomes. It remains retrospective diagnostics only. Production health is now the expanding-date score of the probability actually published; it reports `collecting` until at least 300 paired rows, 20 HR events, and three evaluation dates exist.
- Score calibration no longer applies a circular grade multiplier. Grades remain tracked for reporting, while independent badge multipliers may still apply after their sample gate. The PRIME game cap is explicitly a `displayGrade`; probability calibration and model history use the uncapped `preCapGrade` and score.
- Calibration/training drops legacy rows without `gamePk`, postgame feature captures, non-generation-3 rows, scratches, and known data-health failures. Current-version rows take over from the clean prior-generation bridge after 750 exact rows across five dates.
- The AB simulation resolution weight is 0 in v2. A clean paired replay was slightly worse than the calibrated anchor (Brier 0.094258 vs 0.094248 and AUC 0.5790 vs 0.5798), so it remains traceable shadow evidence rather than an applied tie-break.
- When context ranking stalls, the bounded fallback uses Batter Score plus HR Setup (80/20). In the latest clean ten-date audit it had full coverage and AUC 0.6027 versus 0.5928 for the full score and 0.5836 for the former Batter/Heat/Setup fallback. Batter/Barrel/Setup stays shadow-only despite AUC 0.6179 because coverage was only 68%.
- Known deterministic data-health warnings are attached before canonical combo construction. A warned batter cannot enter automatic HR combos; missing evidence never becomes a neutral prior silently.
- Rollback: restore model/pipeline version 1, restore the prior grade calibration and sim-resolution weight, and switch the UI back only with the matching version-1 historical population. Keep the v2 telemetry fields so evidence is not discarded.

AI-HR production overlay v1 was retired on 2026-08-02. Published HR probability
now stops after the deterministic simulation, calibration, resilience, and
documented statistical overlays. Tavily/OpenAI research, shadow ledgers, and
external-context probability deltas are not part of production. Rollback means
restoring the removed versioned subsystem and its validation gate in one reviewed
change; do not reintroduce an untracked post-process adjustment.

## K Brain

Authority: `src/sports/mlb/logic/kBrain.js`; current model version is 4.

- The primary output is one decimal projected strikeout count, not an outcome range.
- It combines lineup-level batter K tendencies with pitcher season/split/recent miss skill, projected batter-faced volume, pitch efficiency, third-time-through penalty, and park/umpire/weather context.
- The transparent baseline (`K/9 × IP/9 × opponent K% / league K%`) is a comparison/explanation, not a second competing projection.
- Book-line over probabilities are Poisson outputs around the canonical projected K.
- Lineup-aware selection and pregame identity must remain doubleheader-safe.
- Calibration changes require current-model held-out starts; do not tune from the old 45/183 aggregate record alone.

## Forecast V11: moneyline and totals

Authority: `src/sports/mlb/logic/gameProjection.js` and `gameMarketDecision.js`; current model version is 11.

- Team runs begin with opposing-starter expected runs over expected innings plus bullpen runs for the remainder, then apply lineup strength, park/weather, contextual matchup factors, and a small home-field run edge.
- Win probability is a logistic transform of projected run differential (slope 0.45). A one-run edge is roughly 61%, two runs roughly 71%, and three runs roughly 79% before rounding.
- Total pricing uses the independent Poisson scoring contract at the decimal projected total.
- Sportsbook no-vig probabilities and prices measure edge/expected ROI and market quality. They do not define the raw run projection.
- Game-market calls are PLAY, LEAN, or PASS. PLAY requires historical readiness, forward non-drift, edge, ROI, coverage, and at least two books. A raw PLAY is capped to LEAN while validation is not ready.
- Under decisions also expose Blow-Up Risk from the historically calibrated negative-binomial score distribution. It is the chance of finishing at least three runs above the posted total. A HIGH result (one-in-six or greater) prospectively caps an otherwise-qualified Under PLAY to LEAN; it does not change projected runs, Poisson market probability, edge, or ROI. The cap is conservative and must be judged separately on settled forward calls before its threshold is promoted as optimized.
- PASS is directional model information, not a recommended bet.

Run lines are not a production market. Do not reintroduce them without a separately validated pricing and tracking contract.

## NRFI/YRFI first-inning layer

Authority: `src/sports/mlb/logic/firstInningProjection.js` on top of Forecast V11.

- Foundation: three-season MLB first-inning linescores with expanding-date walk-forward validation and sample shrinkage.
- Current teams: season/recent first-inning offense and allowance, strict recent-30 team form as evidence, plus starter first-inning samples.
- Pitcher micro layer: roughly 30-60-day lookback, previous-season blend when the current-season start sample is thin, first-inning FIP, first-time-through K/BB, and handedness-aware top-three lineup quality.
- Park, weather, lineup availability, and Forecast V11 contribute current-slate context.
- NRFI and YRFI probabilities are complementary and sum to 1.
- First-inning calls are STRONG, LEAN, or WATCH. WATCH is diagnostic unless the explicit prospective WATCH-NRFI promotion policy earns promotion from settled results.
- The rolling league-wide 30-day NRFI/YRFI regime is shadow-only until it proves stable Brier improvement.

## List Builder and BetLab

- List Builder filters already-computed batter evidence. AI translates words into visible criteria and may summarize aggregates; it does not score players.
- Curated parlay recipes use selected PRIME/STRONG candidates, pregame status, game separation, and tracked recipe evidence. Randomization may choose among qualified candidates but cannot bypass validity gates.
- BetLab combo strategies and NRFI/YRFI calls remain distinct from List Builder recipes.
- Ignore HR sportsbook prices where the strategy explicitly says to; never silently apply that rule to moneyline/totals pricing.
- Game Combo Lab v1 is a deterministic presentation layer over frozen Forecast V11 and first-inning calls; it does not create or upgrade a market call. It may return at most three recipes: PLAY/LEAN moneyline + WATCH NRFI, PASS Under + WATCH NRFI, or all three together.
- Every Game Combo Lab leg must have a different `gamePk` inside its recipe, both probable starters, and at least 72% source coverage. YRFI, Over, live/final games, missing starters, and HIGH Blow-Up Risk Unders are excluded. PASS and WATCH keep their diagnostic meaning.
- Game Combo Lab all-hit probability is the independent product of the already-produced leg probabilities. Combo price and EV stay unavailable until a real NRFI price is stored. Seven-day 2-leg and 3-leg records are reconstructed deterministically from frozen pregame calls; results grade the recipe but never select its legs.
- Rollback for Game Combo Lab v1 is removal of its BetLab tab and derived UI engine. Forecast V11, NRFI/YRFI, and their tracking records remain unchanged.

## Required proof for a production model change

1. State the hypothesis and exact fields changed.
2. Preserve a baseline and model version.
3. Run unit/data-contract tests.
4. Use date-ordered held-out or prospective outcomes; report sample, event count, dates, Brier/log loss, AUC/ranking lift where applicable, calibration, and tier/top-k results.
5. Add a rollback path and update this record.
6. Do not promote only because a recent anecdotal streak won.
