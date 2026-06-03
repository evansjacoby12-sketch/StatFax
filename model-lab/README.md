# model-lab — fork the HR model, offline

A self-contained sandbox for **forking the StatFax HR probability model and
iterating on it offline** — no live APIs, no R2 writes, no app build. It rides
on data the production pipeline already publishes.

Nothing here ships to the app or the cron. `model-lab/` is dev-only: it's not in
the Expo bundle and not under `server/**`, so editing it never touches prod.

---

## Why this works without rebuilding anything

The model is *already* a pure, Node-runnable module:

- **The engine** — `src/sports/mlb/logic/ProbabilityEngine.js` (`scoreBatter(...)`),
  no React, no network.
- **It already bundles for Node** — `server/build-model.mjs` esbuilds it to
  `server/.build/model.mjs` (RN deps stubbed, `stadiums.json` inlined). That
  bundle is your offline fork.
- **There's a recorded dataset** — R2 `backtest-log.json` carries, per reconciled
  prediction, the model's **20-feature vector** (`feat`) + `score` + `grade` +
  `badges` + `homered` + `actuallyPlayed`.
- **Production runs the same engine on server + client**, so a winning change
  ships to both by editing one file.

---

## Setup

Run from the repo root (uses the repo's Node 20 + esbuild — no extra installs):

```bash
node model-lab/pull-data.mjs       # download backtest-log.json + today's daily.json → model-lab/data/
node model-lab/backtest.mjs        # offline backtest of the RULE model (Brier / LogLoss / AUC / calibration)
node model-lab/train-logreg.mjs    # train a logistic model on the feature vectors; compare vs rule model
node model-lab/score-offline.mjs   # bundle the engine + re-score a recorded input corpus (rule-engine fork)
```

(or `cd model-lab && npm run pull|backtest|train|score`)

---

## The two ways to "build on it"

### 1. Tune the RULE engine (`scoreBatter`)
The whole composite (form × matchup × park × weather × bullpen × zone × Vegas).
Loop:
1. `git worktree add ../statfax-lab model-lab` (or a branch) so prod is untouched.
2. Edit `src/sports/mlb/logic/ProbabilityEngine.js` (or copy it to
   `ProbabilityEngine.lab.js` and point `build-model.mjs` at it via an env var to
   A/B two bundles).
3. `node model-lab/score-offline.mjs` re-scores a recorded input corpus offline.
4. `node model-lab/backtest.mjs` scores the result vs actual outcomes.
5. Keep the variant only if Brier/LogLoss drop and AUC rises on held-out days.

### 2. Train a LEARNED model on the logged features
This path is ready today — the features are already captured.
- `node model-lab/train-logreg.mjs` fits logistic regression on the 20-feature
  vector with a **time-based** train/test split and prints Brier / LogLoss / AUC
  for **baseline vs rule model vs your model**, plus the learned weights so you
  see which features carry signal.
- Build from there: add features, swap the learner (GBM, etc.), change the split.
- Production already has a stacker scaffold to graduate into:
  `server/models/trainEnsembleWeights.mjs` + `ensemble.mjs` (`combineModels`).

---

## Capturing inputs (for full rule-engine replay)

`daily.json` stores the engine's **outputs**, not the ~25-arg `scoreBatter` input
bundle, so `score-offline.mjs` needs a recorded input corpus to faithfully replay
the rule engine. To generate one, log inputs from the cron — mirror what
`server/replay-nan.mjs` already does for NaN cases, but for every batter: in
`server/fetch-slate.mjs`, alongside each `scoreBatter(...)` call, push
`{ id, name, args: [...the same arguments...] }` into an array and write it to
`dist/inputs-<date>.json` (then copy it into `model-lab/data/`). After that,
`score-offline.mjs` re-scores it with zero network and you can diff engine
variants on identical inputs.

Until then, `score-offline.mjs` still proves the offline engine bundles + runs.

---

## Files

| file | what it does |
|---|---|
| `pull-data.mjs` | download R2 `backtest-log.json` + `daily.json` → `data/` |
| `backtest.mjs` | offline metrics on the rule model (per-grade, calibration, Brier/LogLoss/AUC) |
| `train-logreg.mjs` | logistic regression on `feat` → P(HR), vs rule model on a time split |
| `score-offline.mjs` | bundle the engine + re-score a recorded input corpus |
| `lib/metrics.mjs` | Brier · LogLoss · AUC · calibration · isotonic (PAV) |
| `data/` | downloaded artifacts (git-ignored) |

---

## Promote a winner

Because the same engine bundles to the server cron and imports into the client,
shipping a model change is just editing `ProbabilityEngine.js` and committing —
the cron rebuilds `model.mjs` and re-scores; the app picks it up on the next OTA.
No separate artifacts, no drift between server and client.
