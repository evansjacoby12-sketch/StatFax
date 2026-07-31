# StatFax repository instructions

## Before changing code

- Read `MODEL-DECISIONS.md` for production model boundaries and `OPS.md` for deployment/recovery.
- Preserve unrelated user changes. Do not broadly reset, clean, or stage the worktree.
- Never commit credentials or print secret values. `.env.example` contains names only.
- Generated `dist/*` is ignored except `dist/backtest-log.json`. Do not force-add other generated artifacts.

## Source of truth

- HR scoring: `src/sports/mlb/logic/ProbabilityEngine.js` and `server/fetch-slate.mjs`.
- K projection: `src/sports/mlb/logic/kBrain.js`.
- Game forecast: `src/sports/mlb/logic/gameProjection.js`.
- Game decisions: `src/sports/mlb/logic/gameMarketDecision.js`.
- First inning: `src/sports/mlb/logic/firstInningProjection.js`.
- Data contracts: `server/lib/mlbDataContracts.mjs` and validators under `server/tools/`.

Do not duplicate model math in the UI. The UI presents the produced snapshot and may have a tested fallback only where one already exists.

## Change requirements

- Scoring or decision changes require a model version/audit note, validation evidence proportional to risk, updated data contracts, focused tests, and `MODEL-DECISIONS.md` updates.
- AI may narrate, translate filters, research source-backed context, and apply only the explicitly documented capped HR-probability overlay. It may not invent or select predictions.
- Keep `gamePk` in identities; team matchup alone is not doubleheader-safe.
- Preserve pregame freezes after first pitch.
- Missing data must reduce confidence or block a call, never be silently fabricated.
- Do not bypass a validator or make a production publish non-blocking to hide a data failure.

## Verification

For normal changes:

```powershell
npm test
npm --prefix ui run smoke
```

For pipeline/operations changes also run:

```powershell
npm run doctor -- --offline
npm run mlb:audit
npm --prefix ui run build
```

For Worker changes:

```powershell
Set-Location server/cloudflare
npx wrangler deploy --dry-run
```

Use `npm run doctor` after deployment. Push intentionally scoped commits to `main` only when the user asks for that workflow.
