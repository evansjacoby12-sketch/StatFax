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

An optional `dist/nfl/availability.json` (or `NFL_AVAILABILITY_PATH`) can
overlay official inactive and practice-participation updates. Out, IR, PUP,
suspended, and inactive players are removed; Doubtful, DNP, Questionable,
and Limited players receive explicit opportunity discounts. Run
`npm run nfl:backtest` after the history build to produce leakage-safe
walk-forward metrics at `dist/nfl/backtest.json`.

## Current-context overlays

The slate pipeline accepts three timestamped, provider-neutral overlays. Stale
files remain visible as limited coverage and are not presented as current.

- `dist/nfl/depth-chart.json` or `NFL_DEPTH_CHART_PATH`: `{ generatedAt,
  players: [{ espnId, name, depthRank, role, snapShare, targetShare,
  carryShare, goalLineShare }] }`
- `dist/nfl/availability.json` or `NFL_AVAILABILITY_PATH`: `{ generatedAt,
  players: [{ espnId, name, status, practiceParticipation, active }] }`
- `dist/nfl/weather.json` or `NFL_WEATHER_PATH`: `{ generatedAt, games:
  [{ gameId, tempF, windMph, precipProbability, roof, source }] }`

When those files are absent, the slate builds the same contracts automatically.
ESPN team depth pages supply offensive depth order and reported availability;
Open-Meteo supplies outdoor kickoff temperature, precipitation probability,
sustained wind, and gusts for games inside its forecast window. Failures remain
visible in `dataHealth` and fall back to historical role or neutral weather.

## Season tracking and feed health

Each slate run freezes opening and latest pregame forecasts in
`dist/nfl/tracking.json`. Final ESPN box scores settle them and calculate Brier
score for TD markets, projection MAE for volume markets, and unit profit/ROI
only when real prices exist. GitHub Actions caches this ledger across deploys.

`daily.json.dataHealth` reports schedule, roster, depth, availability, weather,
and history independently. The UI also warns when the published slate is more
than 45 minutes old.

The NFL UI stores watchlists, active slips, and up to 50 settled tickets in
local storage. Tickets settle from live/final player stats; First TD legs use
the scorer identifier when the live feed supplies it and void safely when a
final feed cannot identify the scorer.
