# StatFax

MLB home-run and strikeout prop projection engine + live board. Deployed at **statfax.online**.

## What it is

A fully automated daily pipeline that scores every batter on today's MLB slate for HR probability and every starting pitcher for projected strikeouts. The scored snapshot is published to Cloudflare R2 and served to a React UI via GitHub Pages.

## Architecture

```
Cloudflare Worker (cron, every 10 min)
  → repository_dispatch → GitHub Actions

GitHub Actions ("Build slate + deploy")
  1. npm run build-model      bundle the scoring engine
  2. npm run slate            live pipeline → dist/daily.json
  3. R2 upload                publish snapshot to Cloudflare R2
  4. npm run build (ui/)      build Vite + React board
  5. GitHub Pages deploy      serve at statfax.online
```

```
src/
  sports/mlb/logic/     ProbabilityEngine.js (scoreBatter) + scoring modules
  sports/mlb/data/      stadiums.json (park factors + K factors), umpire-factors.json
  logic/                pitcherVulnerability, windInterpreter, …
server/
  fetch-slate.mjs       the pipeline — MLB Stats API + Savant + weather → daily.json
  build-model.mjs       esbuild bundle of the engine → server/.build/model.mjs
  reconcile.mjs         calibration loop (reconcile predictions vs outcomes)
  models/               ensemble stacker + ML rank model
  statcast*.mjs         Statcast data fetchers (expected stats, recent barrels, velo trends)
  catcherFraming.mjs    catcher framing data
  fetch-zone-matchup.mjs  batter vs pitcher zone data
ui/
  src/components/       React board — Board, PitchersView, GamesView, WeatherView, …
  src/lib/              pitchers.js (kBrain), vulnerability.js, data.js, badges.js, …
model-lab/              offline harness — backtest, train, A/B rescore
```

## Local setup

```bash
npm install              # just esbuild (server)
npm run build-model      # bundle engine → server/.build/model.mjs
npm run slate            # full live pipeline — no API keys needed
                         # writes dist/daily.json

cd ui && npm install && npm run dev   # React board at localhost:5173
```

## HR Brain

`src/sports/mlb/logic/ProbabilityEngine.js → scoreBatter()` scores each batter 0–100 for HR probability. The engine is bundled by `build-model.mjs` so the scoring is identical in the pipeline and offline.

**Key inputs per batter:**
- Season HR/9 of opposing starter (park-adjusted via `pitcherVulnerability`)
- Batter Statcast contact quality (barrel %, exit velo, launch angle, blast rate)
- Park × weather × handedness HR factor
- Home-plate umpire HR factor
- Platoon splits (vs LHP/RHP)
- Recent form signals (hot bat, HR streak, due signal)
- Career H2H vs this pitcher
- Zone matchup enrichment (batter SLG vs pitch types the starter throws)
- ML ensemble stacker (blended with rule model when out-of-sample AUC > rule model)

**Grades:** PRIME (top 12% of playable batters) · STRONG · LEAN · SKIP

**Day Rating (1–5★):** Pitching 45% + Environment 30% + Supply 25%, computed from pre-cap PRIME count to correctly reflect raw slate quality.

### AI HR context and shadow projections

`npm run context` researches unstructured, current-day information that the numeric feeds can miss: starter changes, opener or pitch-limit risk, lineup/injury status, roof/weather changes, bullpen availability, and call-ups.

The output at `dist/context.json` is intentionally non-scoring (`mode: "advisory"`, `scoreImpact: false`). Every accepted signal must:

- target an exact slate-owned batter, pitcher, game, or bullpen key;
- include a direct source URL, confidence, observation time, and expiration time;
- use an allowed HR-context category and entity type;
- contain no probability, score, multiplier, or weight fields.

Run `npm run validate:ai-context` to enforce the source contract.

Phase 2 runs `npm run ai:hr-shadow` after the context pass and maintains `dist/ai-hr-shadow.json`. For each affected pregame batter it freezes:

- the engine's published HR probability as the baseline;
- a deterministic shadow probability using `direction × confidence × 0.10` in log-odds space, capped at `±0.25` total log-odds;
- exact signal IDs, notes, model, timestamps, and evidence URLs.

The shadow ledger is a versioned experiment (`mode: "shadow"`, `scoreImpact: false`), is retained for 180 days, and is never read by the production scoring path or UI. Started-game records are frozen while current pregame records can refresh with newer sourced context. Run `npm run validate:ai-shadow` to verify its math and provenance. Phase 3 will reconcile outcomes and compare baseline versus shadow Brier score and calibration before any AI feature is eligible for production.

## K Brain

Poisson-based strikeout projection per starter. Lives in `server/fetch-slate.mjs` (server-side pre-computation) and `ui/src/lib/pitchers.js` (client mirror).

**Model steps:**

| Step | Signal | Detail |
|------|--------|--------|
| A | Per-batter log-odds matchup | `matchupOdds = (pitcherOdds × batterOdds) / leagueOdds` per lineup batter; pitcher splits < 150 BF regressed toward season rate |
| B | Recent form blend | 55% log-odds splits + 45% last-6-start K/BF average |
| C | SwStr% (preferred) or Whiff% | SwStr% (whiffs/pitches, league avg 11%) at 0.30 coefficient; Whiff% fallback at 0.25 |
| D | Pitch-mix boost | Per-pitch whiff lift coefficients (slider/sweeper/curve/change/splitter), only when miss metric unavailable |
| E | Pitch-volume BF model | `expBF = projectedPitches / P-per-BF` from last-6-start pitch counts; falls back to mean IP |
| F | Vegas proxy | Elite-contact lineup (opp K% < 18.5%) → trim pitch volume −5% for earlier-hook risk |
| G | TTTO penalty | BF beyond 18 (3rd time through order) → −12% K rate, applied proportionally |
| H | Environmental multipliers | Temp (`1 + (°F − 72) × 0.003`), umpire K factor, park K factor |

**Output:** λ (Poisson mean), P(K > line) at 3.5–10.5, 10th–90th percentile range, trend (↑/↓/→), confidence (high/med/low).

**K Brain UI features:**
- Filter by pitcher/team search, min projected K (4.5 / 5.5 / 6.5 / 7.5+), confidence, sort
- Enter book line → see your edge instantly
- TTTO, Vegas trim, temp, umpire, park K chips
- H2H K matchup table per pitcher (career K% vs this arm, delta vs season rate, ≥5 AB)
- Live K badge for in-progress games
- K-prop parlay combos (2-leg / 3-leg)

## Pitcher Vulnerability

0–100 score derived from HR/9, K/9, barrel %, exit velo, hard-hit %, ERA, fatigue, recent form, and xStats regression. Two-step park adjustment: strips out the pitcher's home-park bias, then applies today's game-park factor. UI label: TOUGH / NEUTRAL / SHAKY / VULNERABLE.

## Static data

| File | Content |
|------|---------|
| `src/sports/mlb/data/stadiums.json` | Park HR factor, L/R splits, K factor per stadium |
| `src/sports/mlb/data/umpire-factors.json` | HR factor + K factor for 22+ umpires |

## Calibration pipeline

`reconcile.mjs` runs nightly alongside the slate:
- Joins yesterday's predictions to MLB box-score outcomes
- Computes badge/grade lift multipliers via rolling 30-day backtest log
- Fits an isotonic calibration table (score → observed HR rate)
- Trains a logistic ensemble stacker when holdout AUC > rule model

## Pending validation

Two signal up-weights shipped (2026-06-03) without full held-out outcome confirmation:

| Change | Status |
|--------|--------|
| `hot` up-weight (cap 15→20, slope 200→240) | needs held-out re-score once 2wk inputs accrue |
| `homeEdge` up-weight (5→7, 3→5) | needs held-out re-score once 2wk inputs accrue |

To validate: `npm run lab:pull` → accumulate `dist/inputs-<date>.json` in `model-lab/data/` → `npm run lab:backtest` to compare AUC/Brier baseline vs up-weighted.
