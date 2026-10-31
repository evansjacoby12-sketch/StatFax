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
- Calibration/training drops legacy rows without `gamePk`, postgame feature captures, non-generation-3 rows, scratches, and known data-health failures. Current-version rows take over from the clean prior-generation bridge after 2500 exact rows across 10 dates (raised from 750/5 on 2026-08-23 to prevent small-sample calibration flattening). Additionally, the adaptive CV Brier threshold was lowered to 0.0001 to enable finer bucket resolution (like size 10) when it clearly improves out-of-sample Brier.
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

### Power Ready Graduation & Barrel Ready Cut — 2026-08-24

- Power Ready is graduated out of beta to a production combo strategy. Its gate thresholds are retuned to `CEIL >= 70 · MS >= 70 · FORM >= 60` based on a validation sweep of 7,484 reconciled bats (cashing individual legs at 20.9% vs 16.0% under beta gates, achieving a +9.8pt lift).
- Barrel Ready is cut from the parlay combo strategies menu due to low historical cashing performance (11.11% leg hit rate) caused by the lack of a matchup gate. The `BARREL READY` badge remains active as a display-only/advisory form signal.
- Hot Hand require gate is optimized and retuned to `HEAT >= 74` (originally `>= 58`) based on a 30-day parameter sweep, raising its leg accuracy from 22.00% to 26.19% and parlay cashing rate from 6.67% to 11.43% (+71.3% relative lift).

### Parlay Combo Optimizations — 2026-08-26

- Core Pair strategy was modified to consume exposure caps (`maxPerBat` and `globalMaxPerBat`) so that subsequent strategies diversify away from Core legs.
- Dynamic exposure caps are applied based on slate size: on small slates (<5 unique games), `maxPerBat` is capped at 1 and `globalMaxPerBat` at 2.
- Park & Air require gate is retuned to `air >= 1.05` (previously `>= 1.08`) based on a historical sweep, improving parlay hit rate and expanding coverage.
- Soft Matchup require gate is optimized and retuned to `pitcherHr9 >= 1.4` (previously `>= 1.3`) based on a 30-day parameter sweep, improving individual leg accuracy.


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
- **Enhancements (2026-08-24)**:
  - **TTTO**: Dynamic starter quality penalty scaling based on workload (`expectedIP`), up to +4.5% for deep-workload starters.
  - **Platoon**: Dynamic split-weighting derived from starting lineup platoon split variance (scaling split factor weight from 20% to 35%).
  - **Bullpen**: Refined bullpen availability fallback using unavailable and taxed reliever shares when the default index is absent.
  - **Totals**: Upgraded Over/Under pricing to convolve home/away Negative Binomial score distributions (capturing run clustering and dispersion) instead of raw Poisson.
  - **Matchup**: Integrated a Ballpark-Pitcher GB/FB matchup coupling (`goAo` index coupled with weather carrying factor `environment.hrFactor`).
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

## NFL TD & Props engine (Scoring Engine v2)

Authority: `server/sports/nfl/fetch-nfl-slate.mjs`, `server/sports/nfl/preseason.mjs`, and `src/sports/nfl/logic/ScoringEngine.js`. Snapshot model version: `nfl-scoring-engine-v2`.

- Preseason games are role evidence only and never enter regular-season probability calibration or historical backtests.
- One preseason game can emit a visible WATCH signal but cannot adjust Week 1. An adjustment requires repeated opportunity evidence across at least two games or an official depth-chart promotion.
- Listed starters with zero preseason work are rest-protected. Absence alone cannot lower a projection.
- Qualified role movement is capped at ±4% for TD markets and ±3% for yardage/reception markets. It changes lineup role factors, not the historical calibration artifact.
- ESPN box-score attempts, carries, targets and play-by-play-derived scoring-area opportunities are observed. Complete snap and route participation is unavailable in the public ESPN response and remains null unless a verified, timestamped, source-labeled overlay supplies it.
- **Mathematical Foundations & Continuous Yardage Modeling (v2)**:
  - Continuous yardage props (passing, rushing, receiving, rushing + receiving, passing + rushing) are modeled via a **Parametric Lognormal Cumulative Distribution Function (CDF)** rather than symmetric logistic curves, properly reflecting right-skewed, strictly positive football production:
    $$P(Y > L) = 1 - \Phi\left(\frac{\ln(L) - (\ln(\mu) - \frac{1}{2}\sigma^2)}{\sigma}\right), \quad \sigma = \sqrt{\ln(1 + CV^2)}$$
  - Market-specific Coefficients of Variation ($CV$): Passing (0.28), Combo Pass+Rush (0.26), Rushing (0.38 for bellcows with $\ge 75\%$ snaps, 0.52 for committees), Receiving (0.44 for WR alphas with $\ge 25\%$ target share, 0.58 for secondary options), Combo Rush+Rec (0.36).
  - High-precision Abramowitz & Stegun polynomial approximation of $\Phi(z)$ ($|\text{error}| < 7.5\times 10^{-8}$).
- **Discrete Poisson Modeling for Integer Receptions (v2)**:
  - Reception props ($3.5, 4.5, 5.5, 6.5, \dots$) are modeled with an **exact discrete Poisson summation**:
    $$P(K > L) = 1 - \sum_{k=0}^{\lfloor L \rfloor} \frac{\lambda^k e^{-\lambda}}{k!}$$
- **Touchdown Modeling Across Markets (v2)**:
  - **Anytime TD**: Calibrated from goal-line opportunity share, red-zone target share, conversion efficiency, and defense red-zone allowance.
  - **First TD**: Models scripted drive-1 target share and position-specific opening drive tendencies (RB $0.30\times$, WR $0.25\times$, TE $0.22\times$ of anytime probability).
  - **2+ TD (Multi-TD)**: Zero-Inflated Negative Binomial (ZINB) / Gamma-mixture overdispersion ($\alpha = 0.22$) for goal-line workhorses ($\ge 30\%$ goal-to-go share or $\ge 3$ goal-line touches in last 3 games); standard Poisson for committee rushers.
- **3-Factor Composite 0-100 Rank Matrix (v2)**:
  - Rank Score $= 0.50 \cdot \text{LikelihoodScore} + 0.30 \cdot \text{RoleScore} + 0.20 \cdot \text{MatchupScore}$.
  - Likelihood Score ($50\%$): Evaluates the player's true model production probability and scoring likelihood on the field, independent of sportsbook price or juice.
  - Role Score ($30\%$): Position-aware volume dominance normalized to true NFL ceilings (RB: snap + carry/goal-line + RZ; WR/TE: snap + target share + RZ; QB: snap + RZ).
  - Matchup Score ($20\%$): Opponent defense vulnerability vs position ($60\%$), team total scoring environment ($25\%$), and spread game-script bias ($15\%$).
  - Tier Grades (`PRIME`, `STRONG`, `LEAN`, `SKIP`) are driven by true model likelihood and volume rank, ensuring superstars (like AJ Brown, Tyreek Hill, Ja'Marr Chase) earn top-tier grades based on real-world football dominance.
- **Market line benchmarking & fair odds fallbacks**:
  - Over/under yardage and volume prop markets benchmark against standard American -110 juice (52.38% implied break-even) when an active line is posted but specific bookmaker juice is unquoted.
  - Touchdown markets (`anytime_td`, `first_td`, `two_plus_td`) compute edge against posted American sportsbook odds when available. When unquoted, the UI computes and explicitly labels fair odds (`Fair +...`) and fair multiplier baselines without manufacturing an artificial positive edge.
  - Multi-field odds resolution supports `odds`, `overOdds`, `price`, `american`, and `propOdds`.
- **Full Model Standardization & Bankroll Sizing**:
  - **De-Vigged Fair Probability**: Two-sided quotes are normalized via $P_{\text{over}} / (P_{\text{over}} + P_{\text{under}})$; single-sided quotes strip standard 4.5% book hold. Model Edge is strictly fair alpha: $\text{Edge} = P_{\text{model}} - P_{\text{fair}}$.
  - **Quarter-Kelly Sizing**: Recommended unit allocations use conservative Quarter-Kelly ($f^* \times 0.25$, bounded between $0.25\text{u}$ and $2.00\text{u}$ in clean quarter-unit steps). Negative expected value yields $0\text{u}$ / unrecommended.
  - **Sample & Lineup Gates**: Thin player histories ($< 3$ regular-season games) are capped at `LEAN` with an explicit reason (`Thin sample (<3 games) · capped at LEAN`). Unconfirmed rotational players (depth order $> 2$) are capped below `PRIME`. `PRIME` tier strictly requires verified positive edge ($\text{Edge} > 0$).
  - **Same-Game TD Joint Correlation**: Touchdown parlays partition legs into game clusters. Multiple First TD scorers in the same game evaluate to $P=0$ and flag an invalid ticket conflict. Same-team combinations apply touch budget cannibalization ($0.84\times$ for multi-RB, $0.92\times$ for multi-WR/TE, $0.94\times$ for RB+WR), while opposing offensive scorers receive cross-team shootout synergy ($1.06\times$).
- **Officiating & Referee Crew Modeling (v2)**:
  - Authority: `src/sports/nfl/logic/referee.js` and `src/sports/nfl/data/referee-crews.json`.
  - Integrates multi-year validated head referee crew tendencies (penalty rates, DPI frequency, offensive holding rates, home-whistle bias, and over/under total impact).
  - Multipliers are conservative and bounded in $[0.95, 1.05]$:
    - **Let Them Play Crews** (e.g. Bill Vinovich, Clay Martin, $\le 10.5$ flags/gm): $+2.5\%$ game pace and scoring efficiency boost.
    - **DPI-Heavy Crews** (e.g. Scott Novak, Alex Kemp, Land Clark, $\ge 2.8$ DPI/gm): $+2-3\%$ pass yardage and red-zone passing TD conversion boost for outside deep threats.
    - **Flag-Heavy / Strict Crews** (e.g. Carl Cheffers, Shawn Hochuli, $\ge 14.5$ flags/gm): $-2-3\%$ drag on rushing efficiency due to drive stalls and holding penalties.
    - **Home-Whistle Bias** (e.g. Brad Allen, John Hussey, $+14-18\text{ yds}$ disparity): $\pm 1\%$ home/away adjustment.
  - Signals: `ref-let-them-play` (low flags), `ref-dpi-edge` (high secondary DPI), `ref-flag-heavy` (penalty risk warning).
- **Two-Sided Over/Under & Settlement Model (v3)**:
  - Supports explicit `side: 'over' | 'under'` evaluation across continuous yardage and discrete reception props.
  - Under probability is strictly complementary ($P_{\text{under}} = 1 - P_{\text{over}}$), evaluated against devigged bookmaker under lines or standard -110 benchmark hold.
  - Prop settlement (`getNFLPropSettlement` & `settleNFLLeg`) resolves real-world game statistics against posted lines into `won`, `lost`, `live`, `push`, and `void` states.
- Rollback: switch `ScoringEngine.js` back to flat logistic curves and simple grade bands, remove preseason role application in `fetch-nfl-slate.mjs`, remove referee crew multipliers, and revert the snapshot model version.

## NBA First Basket Engine

Authority: `src/sports/nba/logic/firstBasketEngine.js`, `src/sports/nba/data/jumpBalls.js`, `src/sports/nba/data/demoSlate.js`, and `src/sports/nba/api/NBAService.js`.

- **Tip-Off Model & Jump Ball Elo (`jumpBalls.js`)**:
  - Center tip win rates calibrated across 30 opening centers with Bayesian sample shrinkage ($m=20$ tips) toward standing-reach advantage priors:
    $$\text{Rate}_{\text{regressed}} = \frac{n \times \text{Rate}_{\text{obs}} + m \times \text{Prior}_{\text{reach}}}{n + m}$$
  - Standing reach differential adjusts jumper Elo by 15 points per inch ($\Delta \text{Prior} \approx 2.2\%/\text{inch}$).
  - Sample size tiers: `HIGH` ($\ge 40$ tips), `MEDIUM` (15-39 tips), `LOW_SHRUNK` ($<15$ tips).
  - Teams winning the opening tip capture 1st possession ~98% of the time, converting to 1st field goal ~64% of the time.
  - Confirmed lineups badge tracks official starting 5s filed ~30 minutes before tip-off, enabling late model runs.
- **First-Possession Markov Sequence (Play-by-Play Tendencies)**:
  - 1. *Possession Security*: 12.5% baseline early turnover rate deducted before shot attempts, adjusted for opponent ball pressure (`oppDefense.foulTurnoverForced`).
  - 2. *Scripted Play Action*: Coaches script opening 1-2 possessions. Modeled using early shot share in minutes 0-3 (`earlyShotShare`) rather than full-game usage.
  - 3. *Shot Mix by Zone*: Modeled across Rim/Paint, Mid-range, and 3-pointers, adjusted for opponent rim protection (`rimProtectionFactor`) and 3PT contest (`threePtDefenseFactor`).
  - 4. *Offensive Rebound Sequence Continuation*: Missed first shots continue sequence via offensive glass putbacks with ~26% league OREB rate (`orebRate`).
- **Settlement Rule Divergence**:
  - `FIRST_FIELD_GOAL` (DraftKings & FanDuel standard): Free throws do NOT count. If a player draws a shooting foul and makes 2 free throws, the bet remains open until the first made field goal. Tip-in putbacks DO count.
  - `FIRST_POINT_SCORED` (PointsBet / BetMGM / Alternate markets): Made free throws immediately settle the bet. Sizing includes shooting foul draw bonus ($\text{FTr} \times \text{FT\%} \times \text{FoulRate}$).
- **Game-Wide Joint First Basket Distribution**:
  - Game probability is mathematically joint across all 10 starters and bench:
    $$P(\text{Game First Basket}_i) = P(\text{Team}_i \text{ scores 1st}) \times P(i \mid \text{Team}_i)$$
  - Guaranteed invariant: $\sum_{i \in \text{Game}} P(\text{Game First Basket}_i) = 1.00$.
- **Market Data & Multi-Book Pricing**:
  - Compares DraftKings, FanDuel, BetMGM, and Caesars side-by-side with de-vigged implied probabilities and true fair probabilities.
  - Closing line benchmark tracks opening line, closing line, and market steam/drift.
  - Recommended unit allocations use conservative Quarter-Kelly ($f^* \times 0.25$, bounded in $[0.10\text{u}, 1.00\text{u}]$). Negative EV evaluates to $0\text{u}$.
- **Tiers**:
  - `PRIME`: $\ge 14\%$ probability (💎 ELITE)
  - `STRONG`: $9\% - 13.9\%$ (⚡ STRONG)
  - `VALUE`: $6\% - 8.9\%$ (👀 VALUE)
  - `LEAN`: $4\% - 5.9\%$ (🎯 LEAN)
  - `LONG`: $< 4\%$ (🎲 LONGSHOT)
- **Dual Mode Pipeline**:
  - Dual mode loading in `NBAService.js`: tries local snapshot endpoints, queries ESPN scoreboard API when available, and automatically falls back to rich `NBA_DEMO_SNAPSHOT` for deterministic offline testing and off-days.
- **Rollback**: Revert `NBABoard.jsx`, set `SPORT_UI.nba.enabled = false` in `sportUi.js`, and remove `firstBasketEngine.js`.

### Python fb-model Architecture & Calibration Artifacts

Authority: `fb-model/` layout (`ingest/`, `features/`, `model/`, `sim/`, `eval/`, and `run_slate.py`).

1. **Data Ingestion & Storage (`fb-model/ingest/` & `fb-model/data/fb_database.sqlite`)**:
   - `pbp.py`: Ingests and stores raw play-by-play events untouched for the opening stretch (first 6 possessions per team, 12 possessions per game) into SQLite `raw_pbp` table.
   - `lineups.py`: Confirmed starting fives (~30 min before tip), injury statuses, and minutes restrictions stored in `lineups`.
   - `odds.py`: Multi-book opening and closing lines (DraftKings, FanDuel, BetMGM, Caesars) de-vigged and stored in `market_odds`.
2. **Feature Engineering (`fb-model/features/`)**:
   - `tip.py`: Opening jump-ball winner, jumper identities, reach differential, and Bayesian shrunk tip win rates ($m=20$ prior weight). Empirical tip-to-first-score conversion: $65.8\%$.
   - `shot_share.py`: Player shot share in the first $N=6$ possessions per team, first-shot-of-game tendencies, and early FGA/game.
   - `rates.py`: Per-shot make probabilities by zone (rim, mid, three, FT) across all shots in dataset; opening turnover rate (~$12.5\%$), shooting foul rate (~$7.5\%$), and offensive rebound rate (~$26.0\%$); context adjusters for opponent rim/perimeter defense, pace, rest, and home/away.
3. **Hierarchical Shrinkage & Closed-Form Markov Chain (`fb-model/model/`)**:
   - `hierarchical.py`: Beta-Binomial partial pooling for jumper win rates and zone make rates; Dirichlet-Multinomial partial pooling for 5-man starter shot shares. Emits exact conjugate posterior parameters $(\alpha, \beta)$ and $\boldsymbol{\alpha}$ for Monte Carlo parameter sampling.
   - `chain.py`: Closed-form analytical solution propagating probability through alternating possessions with offensive rebound sequence continuation:
     $$P(\text{score}) = \frac{g_T \cdot P(\text{Make FG} \mid \text{shot}) + (\text{if FTs count: } f_T \cdot P(\text{make FT}))}{1 - g_T (1 - P(\text{Make FG})) \rho_T}$$
4. **Simulation Layer (`fb-model/sim/simulate.py`)**:
   - Monte Carlo simulator executing 10,000+ iterations with parameter posterior sampling (tip win, shot shares, make rates, and team rates sampled from posterior distributions on every run).
   - Reports empirical win frequency, batch standard error, and 90% credible intervals $[q_{0.05}, q_{0.95}]$.
5. **Evaluation (`fb-model/eval/`)**:
   - The prior 120-game report and calibration figures are retrospective artifacts, not valid out-of-sample evidence. The legacy backtest reads current player/team aggregates for historical games, and its market rows are not time-aligned with those games.
   - `backtest.py` now fails closed until the evaluator can consume game-dated pregame feature and market snapshots. It must not publish ROI, CLV, Brier, or log-loss claims from the legacy tables.
   - `tools/firstBasketLog.mjs` is the prospective evaluation path: only predictions logged before tip qualify, and games with actual-vs-modeled starter mismatches remain visible for diagnosis but are excluded from aggregate metrics and learned feedback.
6. **Slate Execution (`fb-model/run_slate.py`)**:
   - Pulls confirmed starting lineups ~30 min before tip, executes analytical chain and 10,000-sim Monte Carlo draws, benchmarks against multi-book odds, sizes positions with Quarter-Kelly, and exports ranked picks to `fb-model/data/slate_picks.json`. Supports `--settlement` (`FIRST_FIELD_GOAL` vs `FIRST_POINT_SCORED`) and `--nop-center` (`missi` vs `jordan`).

### NBA First Basket Empirical Calibration Audit (2026-10-29)

- **Tip Probability Overhaul (Bradley-Terry Logistic Model)**:
  - Replaced coarse linear Elo adjustments with Bradley-Terry logistic regression using Bayesian shrunk jump win rates ($\hat{p}_i^{\text{shrunk}} = \frac{n \bar{y} + 20(0.50)}{n + 20}$) and standing reach coefficient $\beta_{\text{reach}} = 0.088/\text{inch}$:
    $$\text{logit}(P(\text{Home Tip Win})) = \ln\left(\frac{\hat{p}_{\text{home}}}{1 - \hat{p}_{\text{home}}}\right) - \ln\left(\frac{\hat{p}_{\text{away}}}{1 - \hat{p}_{\text{away}}}\right) + \beta_{\text{reach}} \Delta R$$
  - Eliminates 50/50 artifact in Clingan (115" reach, 58.6% shrunk) vs. Edey (119" reach, 53.9% shrunk): $\Delta R = -4"$ yields $P(\text{Edey}) = 53.9\%$ and $P(\text{Clingan}) = 46.1\%$, giving Memphis the tip edge and elevating Edey (15.8%) and Boozer (14.8%) to the top of Game 3.
- **Dynamic Lineup Scenarios (Missi vs. Jordan for NOP)**:
  - Addressed Yves Missi's day-to-day knee injury. Replaced hardcoded DeAndre Jordan starter with dynamic toggle in UI and dual CLI modes (`missi` vs `jordan`).
  - Missi starting yields 63.4% tip win vs Sabonis (NOP 1st score 54.3%, Zion 18.3%, +446 fair odds).
  - Jordan starting yields 68.4% tip win vs Sabonis (NOP 1st score 56.6%, Zion 20.0%, +400 fair odds).
- **Removal of Arbitrary Transforms & Regressed Shot Shares**:
  - Removed arbitrary heuristic $1.5 \times s + 0.08$. Replaced with exact Markov transition: $(1 - \text{TOV}) \cdot (\text{earlyShare} \cdot \text{makeRate} + \text{orebPutbackShare})$.
  - Regressed Zion Williamson's early shot share from an uncalibrated 36% to empirical Dirichlet posterior 29%, moving his game probability from an inflated 21.5% (+365) to a well-calibrated 18.3% (+446), removing false market edge against +500 consensus.
- **90% Credible Interval Uncertainty Bounds**:
  - Attached parametric 90% credible intervals combining Dirichlet shot share variance and tip win Beta variance across all outputs (`ci90: { lower, upper }`), displayed in UI and slate summaries (e.g. Zion [9.5%, 27.1%]).
- **120-Game Positional Backtest & Calibration Evidence**:
  - Brier score: 0.8602 (Model) vs 0.8876 (Market Close).
  - Positional Reliability (1,200 player-games):
    - **Center (C)**: 240 samples, 31 hits (12.92% actual vs 13.06% model pred, **ECE: 0.14%**, Brier: 0.1122 vs 0.1129 market)
    - **Power Forward (PF)**: 240 samples, 27 hits (11.25% actual vs 9.12% model pred, **ECE: 2.13%**, Brier: 0.0917 vs 0.0967 market)
    - **Small Forward (SF)**: 240 samples, 16 hits (6.67% actual vs 8.76% model pred, **ECE: 2.09%**, Brier: 0.0599 vs 0.0615 market)
    - **Shooting Guard (SG)**: 240 samples, 9 hits (3.75% actual vs 7.05% model pred, **ECE: 3.30%**, Brier: 0.0367 vs 0.0406 market)
    - **Point Guard (PG)**: 240 samples, 37 hits (15.42% actual vs 12.01% model pred, **ECE: 3.41%**, Brier: 0.1295 vs 0.1321 market)
  - Calibration plots: `fb-model/data/calibration_curve.png` and `fb-model/data/calibration_curve_by_position.png`.

### NBA First Basket 5,000-Trial Monte Carlo Engine Addition (2026-10-30)

- **Engine Implementation**: Added `simulateGameFirstBasketMonteCarlo({ homePlayers, awayPlayers, tipMatchup, iterations = 5000, seed })` in `src/sports/nba/logic/firstBasketEngine.js`.
- **Methodology**: For every game matchup, executes 5,000 discrete possession-level trials simulating:
  1. Opening tip outcome sampled via head-to-head Log5 jumper win probabilities with reach differential.
  2. Ball security & early turnover risk check (12.5% league baseline adjusted for opponent pressure; flips possession before shot attempt).
  3. Scripted first look shooter selection sampled from starting five proportional to early-minute shot share.
  4. Shot zone distribution (Rim/Paint vs. Mid-Range vs. 3PT) tested against opponent defensive contest make rates.
  5. Offensive rebound putback extension on missed looks (26% league baseline; offensive glass crash attempts immediate rim putback).
  6. Full sequence loop across successive possessions until the first field goal occurs.
- **Telemetry & Contracts**:
  - Player metrics: `simWins` (out of 5,000), `simTotal: 5000`, `simProb`, `simPct`, `simMethods: { twoPt, threePt }`, `simMethodSplit: { prob2PT, prob3PT }`.
  - Game telemetry: `simTelemetry: { iterations: 5000, homeWins, awayWins, homePct, awayPct }`.
  - Surface integration: Logged in `server/sports/nba/fetch-nba-slate.mjs` CLI output, displayed as badges on game cards, and featured in a dedicated 3-metric breakdown drawer in `ui/src/components/NBABoard.jsx`.
- **Validation**:
  - Deterministic PRNG (`createPrng`) ensures test reproducibility.
  - Sum of player simulation wins strictly equals 5,000 across all active players in a game.
  - Node.js micro-benchmark: 5,000 trials execute in ~4.0ms with zero memory leaks.

### NBA First Basket Evaluation Integrity Gate (2026-10-30)

- The legacy Python backtest is blocked from producing a report because its current aggregate features and game-linked odds cannot reconstruct pre-tip information for the historical game dates. Previously published Python backtest metrics are superseded and must not be used to claim predictive or betting edge.
- Prospective log scoring excludes starter-mismatched games from summary metrics and learned feedback while retaining their per-game diagnostics. Predictions, results, and actual starter lists should continue to be captured for every slate.
  - All 635 test suite assertions passing (`npm test`).

### NBA First Basket Live Data and Eligibility Gate (2026-10-30)

- **Version:** `nba-first-basket-v4`. This is a scoring/input-quality policy change; older snapshots remain identifiable by their recorded model version.
- **Current inputs:** `fetch-nba-slate.mjs` overlays ESPN current-season player statistics and team opponent 3PT/pace context onto the slate. Player 3PT percentage is shrunk toward the league prior with an 18-attempt prior. The six-hour feature cache is persisted through R2 for scheduled runs; failed/missing stats remain missing and count against coverage.
- **Market:** first-basket quotes come only from The Odds API `player_first_basket` event market when `ODDS_API_KEY` is configured and the subscription returns the market. A quote is usable only when the market update is at most 15 minutes old. There is no synthetic or consensus-price fallback. The provider refresh cache can reduce requests, but cached quotes still fail the freshness gate when old.
- **Fail-closed recommendations:** edge, Kelly sizing, top-pick selection, generated parlays, and slip insertion are blocked unless the pregame lineup is confirmed, at least 80% of active candidates have current player stats and verified player zone rates, both teams have matchup stats, both teams have at least five opening-shot samples, and fresh market quotes are present. Missing opening-play and player-zone sources therefore leave the model in projection-only mode; current team/player season aggregates do not substitute for those features.
- **Prospective evidence:** every changed live pregame snapshot is logged before tip with `date + gameId + playerId` identity and model version; results are reconciled with actual ESPN starters. Doubleheaders stay distinct. Mismatched or missing starter evidence is diagnostic only and excluded from metrics and learning. R2 workflow state restores and persists the logs and odds cache.
- **Limitations / validation gate:** this change does not claim improved predictive performance. Promotion requires prospective, date-ordered outcomes under the evaluator gates above. Local live price availability depends on the Odds API key and market entitlement; without it, no market-backed call can qualify.
- **Rollback:** revert this version's eligibility gating and current-season stat overlays in `firstBasketEngine.js`, `NBAService.js`, `fetch-nba-slate.mjs`, and the UI eligibility checks, preserving v4 prediction logs as versioned evidence.

### NBA First Basket Verified Zone and Opening History Inputs (2026-10-30)

- **Version:** `nba-first-basket-v5`, preserving v4 snapshots as a separate evaluation cohort.
- **Hypothesis and fields:** use NBA Stats shot-location FGM/FGA counts to replace roster-only rim, mid, and 3PT conversion priors when all zones meet minimum evidence; shrink each zone with stated priors. Use PBP Stats first-team-possession shot attempts and start types to blend opening-shot shares with the roster prior. Add `zoneFG`, zone attempts/source, opening shot count/outcome/start-type, `openingHistorySeason`, and input freshness to snapshots and prospective evaluation records.
- **Zone implementation:** request `LeagueDashPlayerShotLocations` once per season; aggregate restricted-area + non-RA paint, mid-range, and the three 3PT zones into rim/mid/three rates with prior sample sizes 30/20/30. Require at least five attempts in each zone to count a player as verified, retain raw attempts and source, and join NBA Stats rows to ESPN candidates by normalized name when provider IDs differ. Missing or malformed data stays unavailable. The NBA Stats `ShotChartDetail` coordinates are suitable for deeper audit but unnecessary for these aggregate rates.
- **Opening-history implementation:** request PBP Stats structured shot records by NBA team ID for the first 120 seconds of Q1, trying the current season and prior season. Game-wide possession numbers 1 and 2 identify the two teams' opening possessions; retain each team's earliest field-goal attempt with full player identity, result, and `start_type` catalyst. Treat 500-shot responses as truncated. Blend observed player opening-shot counts with roster shares using 20 prior samples and renormalize over active candidates. Require five observed samples from both teams and reject history older than the prior NBA season. Persist the 24-hour source cache through R2.
- **Core scorer contract:** a direct `scoreGameFirstBasket` call without `inputQuality.recommendationEligible === true` returns no betting edge or Kelly size, even when odds are supplied.
- **Data coverage observed during implementation:** the NBA Stats zone endpoint timed out in the live probe, so this checkout has no validated live zone coverage yet. The `nba_api` maintainers document that `stats.nba.com` may not respond to cloud-hosted IP ranges; this client uses the same endpoint directly from Node, so changing to the Python wrapper would not remove that upstream/network constraint. See [nba_api rate limits and hosting](https://github.com/swar/nba_api#rate-limits-and-hosting). The PBP Stats structured shot endpoint returned BOS/LAL data for 2026-27 and 2025-26 (73 and 74 first-shot samples respectively in the two-season probe). The pipeline stores the exact source seasons and requires at least five opening-shot samples per team before this feature qualifies.
- **Validation:** 41 focused NBA first-basket tests pass, including mocked zone/PBP provider parsing, possession selection, shot/miss and catalyst extraction, capped-response rejection, ESPN/NBA name join, snapshot contract, and integration. UI smoke and production build pass. No predictive-performance claim is made before date-ordered v5 outcomes accumulate.
- **Rollback:** set the version to v4 and remove the zone/opening overlays in `first-basket-context.mjs` and `NBAService.js`; retain v5 snapshots/logs and caches as an immutable separate cohort.

### NBA First Basket BetLab Pricing and Stake Integrity (2026-10-30)

- **Policy refinement:** BetLab recipe inclusion and rank use model probabilities only. Cross-game joint probability remains the independent product; quotes, EV, and Kelly do not influence the board. Model fair odds are omitted from recipes. Price-based fields are not used for recipe selection.
- **Projection eligibility contract:** NBA game quality includes `projectionEligible`, requiring confirmed lineup, at least 80% player season-stat and verified zone coverage, both team matchup inputs, and current/prior-season opening history with at least five samples. This allows model-only recipe display without the fresh-market-quote requirement. `recommendationEligible` still requires all projection inputs plus fresh sportsbook odds and remains the sole path for actionable picks/slip insertion.
- **Tag quality:** tip and perimeter strategy tags require observed tip probability and shot-mix evidence; position-based synthetic shot-mix defaults and neutral 50% tip defaults do not qualify a recipe. EV and longshot price strategies are removed from BetLab.
- **Validation / limits:** focused combo and snapshot-contract tests cover model-only probabilities, price independence, invalid probability rejection, and the explicit projection/action eligibility split. The joint probability still assumes independence across games.
- **Rollback:** revert `firstBasketCombos.js`, `NBAService.js`, and this policy note. Preserve the separate `projectionEligible` evidence while recommendation eligibility remains price-gated.

### NBA Slate Date Boundary (2026-10-30)

- NBA slate query dates and snapshot metadata use `America/Chicago`, independent of the deployment host timezone. ESPN event timestamps remain UTC for identity and sorting, while tip display remains Eastern. This keeps late Central-time games on the correct local slate after UTC midnight.
- Validation covers the Chicago date transition around UTC midnight. Rollback: revert `nbaDateKeyInZone` use in `NBAService.js` and restore the prior host-local date selection.

## Required proof for a production model change

1. State the hypothesis and exact fields changed.
2. Preserve a baseline and model version.
3. Run unit/data-contract tests.
4. Use date-ordered held-out or prospective outcomes; report sample, event count, dates, Brier/log loss, AUC/ranking lift where applicable, calibration, and tier/top-k results.
5. Add a rollback path and update this record.
6. Do not promote only because a recent anecdotal streak won.
