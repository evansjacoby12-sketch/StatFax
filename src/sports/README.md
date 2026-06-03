# `src/sports/` — per-sport code

Sport-specific code lives here under `mlb/`, `nba/`, `nfl/`. Code that
applies to ALL sports (UI primitives, auth, theme, parlay, bankroll)
stays at `src/` top-level.

## What goes in a sport folder

```
src/sports/{sport}/
├── api/        ← {Sport}Service.js — wrappers for the sport's
│                  authoritative stats API (MLB Stats API, NBA Stats API, etc.)
├── data/       ← Static reference data (stadiums.json, team metadata,
│                  position-specific data, anything sport-shaped)
├── logic/      ← Scoring engine, calibration, simulators. The math
│                  that produces "this player is a 76" from raw inputs.
└── screens/    ← (Optional) sport-specific screen overrides if the
                   generic top-level src/screens/ doesn't fit.
```

## What stays at `src/` top-level

- `components/` — Generic widgets (modals, cards, hover tooltips, etc.)
  that work for any sport. BatterRow stays for now since the sport-
  agnostic version doesn't exist yet — when NBA needs its own player
  row, extract a generic PlayerRow and have BatterRow be the MLB
  variant inside `sports/mlb/components/`.
- `context/AppContext.js` — Single global context. Holds `activeSport`
  plus per-sport state slices (mlbResults, nbaResults, etc.).
- `screens/` — Generic screens (ParlayScreen, BankrollScreen, AuthScreen,
  SettingsScreen, AboutScreen, GuideScreen, WeeklyScreen). These read
  from the active sport's data via context.
- `theme/` — Design tokens, conventions helper.
- `logic/windInterpreter.js` — Sport-agnostic; baseball uses it for
  HR-env scoring, football could use it for kicking/passing wind effects.
- `api/BackendService.js` — Sport-aware: fetches `/${activeSport}/daily.json`
  from R2.
- `api/SupabaseClient.js` — Auth is sport-agnostic.

## Adding a new sport

1. `mkdir -p src/sports/{sport}/{api,data,logic}`
2. Write `{Sport}Service.js` for the API wrapper.
3. Write the scoring engine in `logic/ProbabilityEngine.js` (or
   `{Sport}ScoringEngine.js`).
4. Add the sport's static data files under `data/`.
5. Update `server/fetch-slate.mjs` (or fork into `server/sports/{sport}/`)
   to write `dist/{sport}/daily.json`.
6. Add a workflow in `.github/workflows/{sport}-cron.yml` mirroring
   slate-cron.yml but pointing at the sport-specific generator.
7. Add the sport to the picker UI (currently in DesktopSidebar's
   sport dropdown).
8. Update `BackendService.fetchSnapshot()` to know about the new sport.

See [`mlb/`](./mlb/) for the reference implementation.
