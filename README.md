# statfax-brain

The **headless brain** of StatFax — the MLB home-run probability engine, the
data pipeline that feeds it, and the offline model lab. **No UI.** Forked out of
the HRSauce app so you can iterate on the model (and build a fresh UI on top)
without the React Native app in the way.

Pure Node 20 (ESM, global `fetch`). The only npm dependency is `esbuild`.

```bash
npm install              # just esbuild
npm run build-model      # bundle the engine → server/.build/model.mjs
npm run lab:score        # prove the engine bundles + loads, fully offline
npm run lab:pull         # download R2 backtest data → model-lab/data/
npm run lab:backtest     # offline metrics on the model
npm run lab:train        # train a model on the logged feature vectors
npm run slate            # run the full live pipeline (needs network; no keys)
```

## What's here

```
src/
  sports/mlb/logic/   ProbabilityEngine.js (scoreBatter) + all scoring modules
  sports/mlb/data/    static data — stadiums, park factors, umpire factors, …
  sports/mlb/api/     MLBService — MLB Stats API client
  logic/              windInterpreter, parlayPairings, pitcherVulnerability, …
  data/               team colors + other static JSON
  utils/, api/        support (backtest log reader, snapshot client). NOTE: a few
                      app-glue files here still import react-native / expo-* /
                      @sentry (notifications, pushNotifications, pollers,
                      SentryConfig, SupabaseClient). The engine + pipeline never
                      import them — they're harmless carry-along you can delete.
server/
  fetch-slate.mjs     the pipeline: fetch MLB API + Savant + weather, score
                      every batter, emit dist/daily.json
  build-model.mjs     esbuild-bundles the engine for Node (server/.build/model.mjs)
  reconcile.mjs       calibration loop (reconcile predictions vs outcomes)
  weather.mjs, statcast*.mjs, catcherFraming.mjs, fetch-zone-matchup.mjs
  models/             ensemble.mjs + trainEnsembleWeights.mjs (learned stacker)
  lib/asyncstorage-stub.mjs   RN-only shim aliased by build-model for Node
model-lab/            offline harness — pull-data, backtest, train-logreg, score-offline
```

## The engine is the source of truth

`src/sports/mlb/logic/ProbabilityEngine.js` → `scoreBatter(...)`. `build-model.mjs`
bundles its full closure into a single Node file (`server/.build/model.mjs`) with
the RN-only async-storage import aliased to a no-op. `fetch-slate.mjs` imports that
bundle so scoring is identical everywhere. Edit the engine → re-run `build-model`
→ everything downstream picks it up.

## Live pipeline

`npm run slate` hits live MLB Stats API + Baseball Savant — no keys, no secrets.
It writes the scored slate to `dist/daily.json`. There's no odds integration and
no R2 upload here (that lived in the HRSauce GitHub Action) — add your own publish
step if you want to serve the snapshot to a UI.

## Build on it

- **Tune the rule engine** — edit `ProbabilityEngine.js`, `npm run lab:score`
  re-scores a recorded corpus offline, `npm run lab:backtest` compares metrics.
- **Train a learned model** — `npm run lab:train` fits a model on the logged
  feature vectors; graduate it into `server/models/`.
- **New UI** — `fetch-slate.mjs` produces `dist/daily.json` (the scored slate);
  point any front-end at that shape. See `model-lab/data/daily-*.json` for an
  example payload. A ready-made front-end lives in [`ui/`](ui/README.md) — a
  Vite + React "model board" that reads `dist/daily.json` directly
  (`cd ui && npm install && npm run dev`).

## Capturing inputs (held-out counterfactual re-scoring)

`daily.json` stores model **outputs** (the final score/grade), not the inputs
that produced them — so you can't subtract a term (e.g. the old "Due" bonus)
from a historical row and re-score it. To do *true* held-out counterfactuals,
the slate freezes the exact `scoreBatter()` argument list for every batter:

```bash
npm run slate        # writes dist/daily.json + dist/inputs-<date>.json
npm run lab:score    # re-scores that corpus with the CURRENT engine, offline
```

`dist/inputs-<date>.json` is an array of `{ id, name, gamePk, args:[…] }`, where
`args` is the 27-argument bundle spread straight back into `scoreBatter()`.
`lab:score` reads `dist/` (freshest local run) **and** `model-lab/data/` (pulled
history), bundles the engine, and re-scores every record with zero network — so
the fork loop is: edit `ProbabilityEngine.js` → `npm run lab:score` → diff scores.

To build a **multi-day** held-out set, accumulate the dated files in
`model-lab/data/` (they're gitignored and persist locally): copy each run's
`dist/inputs-<date>.json` there, or publish the file next to `daily.json` and
pull it. Joining `inputs-<date>.json` (by `id`/`gamePk`) to the reconciled
outcomes in `backtest-log.json` is what lets you compute a real AUC/Brier delta
for any engine change.

## ⏳ Pending validation — retro-check by ~2026-06-17

Three model changes shipped (2026-06-03) on **within-grade audit evidence**
(`npm run lab:audit`), but only the first has a clean outcome-validated history:

| change | evidence | status |
|---|---|---|
| **Due bonus removed** (`dueBonus`/`dueAndHotBonus` → 0) | due bats homer LESS; PRIME 32% vs 46% for grademates | falsified on 11d/2.6k rows ✓ |
| **`hot` up-weight** (cap 15→20, slope 200→240) | +17.6 within STRONG, +16.2 SKIP, +8.6 LEAN | **needs held-out re-score** |
| **`homeEdge` up-weight** (tiers 5→7, 3→5) | +8.4 PRIME, +8.0 STRONG | **needs held-out re-score** |

The two up-weights shipped early on the same standard that justified killing Due,
but were **not** confirmed against outcomes (the inputs corpus started logging
2026-06-03, so only 1 day existed). **To-do once ~2 weeks of `dist/inputs-*.json`
have accrued:**

1. Pull/accumulate the dated input files into `model-lab/data/`.
2. Join them (by `id`/`gamePk`) to reconciled outcomes in `backtest-log.json`.
3. Re-score baseline vs. up-weighted engine and compare real **AUC/Brier**
   (extend `model-lab/ab-rescore.mjs`, which already A/Bs two bundles on frozen
   inputs — add the outcome join).
4. If the up-weights beat baseline → keep. If not → revert (one commit each);
   the prototype also lives isolated on branch `claude/hot-home-upweight`.

`npm run lab:audit` should also be re-run as days accrue to re-police every
signal (it's what caught Due, and currently flags `cold` as possibly too weak
and `dayEdge`/`launchPad` as noisy).

Originated from HRSauce; this copy is standalone and has no git history, no
remote, no commits required.
