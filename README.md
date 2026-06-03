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

Originated from HRSauce; this copy is standalone and has no git history, no
remote, no commits required.
