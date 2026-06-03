# `src/sports/nfl/` — NFL scoring + data

**Status: scaffolding only.** No scoring engine, no API wrapper, no
data. The sport-picker dropdown shows "NFL — Coming Soon" until this
directory has a working pipeline.

## What needs to ship before NFL goes live

1. **`api/NFLService.js`** — wrapper for an NFL stats API. Options:
   - SportsDataIO (commercial, comprehensive)
   - nflfastR data (free, but R-centric — would need conversion)
   - ESPN's undocumented API (fragile but free)
2. **`data/stadiums.json`** — 32 NFL stadiums with location, surface
   (turf vs grass), roof type, elevation, weather exposure.
3. **`logic/ScoringEngine.js`** — Multi-stat prop scoring. Different
   from MLB and NBA:
   - Per-position prop universe is broad (QB pass yards/TDs, RB rush
     yards, WR receptions, TE longest catch, K field goals, etc.)
   - Weekly cadence not daily — slate is Thu/Sun/Mon, not every night
   - Injury reports + practice participation drive much of the
     opportunity-share math
4. **`server/sports/nfl/fetch-slate.mjs`** — daily during the week,
   writes to R2 as `nfl/daily.json`. Different rate-limiting profile
   since the slate doesn't change as often as MLB's.
5. **Snapshot contract** — define NFL `Snapshot` typedef. Likely has
   `playersByPosition` rather than `scoredBatters`, plus injury report
   data and snap-share projections.
6. **NFL cron workflow** — fires Tue (injury reports), Thu (TNF
   lineups), Sat (final inactives), Sun (gameday). Different from
   MLB's every-10-minutes schedule.

See [`../README.md`](../README.md) for the per-sport directory pattern
and [`../mlb/`](../mlb/) for the reference implementation.
