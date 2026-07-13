# `src/sports/nfl/` — NFL prop scoring + data

The NFL workspace supports QB, RB, WR, and TE props across Anytime TD,
First TD, 2+ TD, passing yards, receptions, receiving yards, rushing
yards, rushing + receiving yards, and passing + rushing yards.

## Modules

- `data/demoSlate.js` is the safe local fallback and documents the UI
  snapshot contract.
- `api/NFLService.js` loads `nfl/daily.json`, validates it, and merges
  partial live player updates.
- `logic/propEligibility.js` applies position and minimum-line rules.
- `logic/ScoringEngine.js` blends projection, role, defense by
  position, home/away split, weather, price, and live pace.
- `logic/signals.js` creates TD, reception, passing, rushing, receiving,
  red-zone, workload, and split badges.
- `logic/weather.js` applies small, market-specific outdoor effects.

## Historical data

Run `npm run nfl:history` to build `dist/nfl/history.json` from nflverse
weekly player and play-by-play releases from the 2020 season onward.
The lighter `npm run nfl:history:quick` skips play-by-play-derived
red-zone, weather, and defense-by-position features.

The UI remains in disclosed demo mode until a current-week projection,
injury, live-stat, and sportsbook-odds provider writes an NFL daily
snapshot matching this contract.

## Current slate

Run `npm run nfl:slate` to write `dist/nfl/daily.json`. The pipeline uses
ESPN for the schedule, active rosters, injury status, and live boxscores;
joins `dist/nfl/history.json` when the nflverse history build is present;
and adds live SportsGameOdds prices when `SPORTSGAMEODDS_API_KEY` is set.
Without an odds key, model-reference lines remain clearly unpriced.
CI caches the full history build, including play-by-play-derived red-zone
usage and defense allowed by position, so the large download is paid only
when the history builder changes.
