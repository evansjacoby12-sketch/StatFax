# `src/sports/nba/` — NBA scoring + data

**Status: scaffolding only.** No scoring engine, no API wrapper, no
data. The sport-picker dropdown shows "NBA — Coming Soon" until this
directory has a working pipeline.

## What needs to ship before NBA goes live

1. **`api/NBAService.js`** — wrapper for NBA Stats API (stats.nba.com
   has an undocumented JSON API; or use a commercial provider like
   SportsDataIO).
2. **`data/arenas.json`** — 30 NBA arenas with location, capacity, any
   home-court factors (some arenas inflate scoring vs others).
3. **`logic/ScoringEngine.js`** — Points/Rebounds/Assists prop scoring.
   Different from MLB:
   - Continuous thresholds (over/under 22.5 pts) instead of binary HR
   - Per-game minutes projection drives everything
   - Pace, opposing defense, rest days, back-to-backs matter heavily
4. **`server/sports/nba/fetch-slate.mjs`** — daily cron pipeline,
   writes to R2 as `nba/daily.json`.
5. **Snapshot contract** — define the NBA `Snapshot` typedef (different
   from MLB's; has games, players, projected stat lines, prop odds).
6. **NBA cron workflow** — `.github/workflows/nba-cron.yml`, runs on a
   different schedule (NBA games are evening only, vs MLB all day).

See [`../README.md`](../README.md) for the per-sport directory pattern
and [`../mlb/`](../mlb/) for the reference implementation.
