# StatFax UI — HR Model Board

A fresh **Vite + React** front-end for the StatFax brain. It reads the scored
slate the brain emits at `../dist/daily.json` and presents it as a **pure model
board**: every batter ranked by the engine's own HR probability / grade, with
the model's reasons surfaced — not a market-first betting screen (market odds
are present as secondary enrichment).

## Run it — always-on (recommended)

Double-click **`StatFax.bat`** (repo root), or from the repo root:

```bash
npm --prefix ui install && npm --prefix ui run build   # build the UI once
npm run serve                                          # → http://localhost:5180
```

`npm run serve` ([server/serve.mjs](../server/serve.mjs)) is a zero-dependency
Node server that **serves the built UI + live `dist/*.json`** and
**auto-refreshes the slate every 20 minutes** — no manual `npm run slate`, no
cron. Point ngrok (or any tunnel) at port 5180 for phone access. Configure with
`PORT=` and `REFRESH_MINUTES=`. Status at `/api/status`.

## Run it — development

```bash
npm run slate        # repo root: generate a slate → dist/daily.json
cd ui && npm install && npm run dev   # → http://localhost:5180 (HMR)
```

The dev server reads `../dist/daily.json` fresh per request via a Vite plugin
that serves the brain's `dist/` at `/data/*`. (Stop the dev server before using
the always-on `npm run serve` — both use port 5180.)

```bash
npm run build        # production bundle → ui/dist
npm test             # (repo root) engine + UI logic tests — node --test, no deps
```

## What's on the board

- **Two views** (toggle, persisted): a **ranked board** and a **game-by-game**
  view — each game a card with team logos + color-gradient backdrop, live
  score/inning, starters, and two per-team **silos** of batters. All filters,
  sort, watchlist, parlay, and the drawer work in both.
- **Ranked leaderboard** — sort by HR probability, model score, rating, lineup
  spot, name, or market edge. Filter by grade (PRIME / STRONG / LEAN / SKIP),
  game, signal badge, confirmed-lineup-only, or free-text search.
- **Grade chips & colors** come straight from the engine (`grade.color`), so the
  UI speaks the model's own visual language.
- **Signal badges** — hot / due / cold / pen-edge / home-edge / road-edge / drag.
- **Top reason** shown inline per row; full reason list + plain-English "Why"
  (the engine's `eli5Reasons`) in the drawer.
- **Player drawer** — hero probability, score breakdown (batter / matchup / env),
  season & last-30 hitting, Statcast (barrel%, EV, launch, xStats), a **weather
  panel** (wind compass dial, temp, humidity, precip, roof), the opposing pitcher
  with splits, **career H2H vs this batter**, and recent starts, plus the per-book
  market table (model edge vs FanDuel / DraftKings, with bet links).
- **Live "HR" tag** — batters who have already homered in an in-progress game are
  flagged right on the board (from `liveContext.isHRThisGame`).
- **Model panel** (click the Brier pill) — Brier / log-loss vs baseline, a
  reliability diagram, and per-grade accuracy.
- **Watchlist** — star any batter (row or drawer); filter to "Watchlist".
- **Parlay builder** — add legs with the `+` on a row (or the drawer button); a
  bottom-right slip shows combined model probability, parlay price (or model-fair
  odds when a leg isn't priced), and edge. Click it to expand, reorder, remove.
- **Live auto-refresh** — the **Auto** button soft-reloads the slate every 60s
  (no flicker; filters, selection, watchlist, and parlay all survive).
- **Persistence** — watchlist, parlay, the auto-refresh toggle, and your grade /
  sort / confirmed / watchlist filters are saved to `localStorage`.

## Layout

```
ui/
  vite.config.js        dev plugin that serves ../dist at /data/*
  src/
    App.jsx             state: load, filter, sort, selection
    lib/
      data.js           load daily.json, dedupe rows, attach odds + edge
      format.js         number / odds / date formatters
      badges.js         grade + badge + eli5-icon vocabulary
    components/
      Header, Filters, BatterTable/Row, PlayerDrawer, ModelPanel, atoms, Icon
    index.css           dark-OLED design tokens (Inter + JetBrains Mono)
    app.css             component styles
```

## Notes on the data shape

- `scoredBatters` is emitted under **two** keys per batter (a bare `playerId` and
  a composite `playerId-gamePk`); `data.js` dedupes on `playerId-gamePk` so each
  batter appears once (also correct for doubleheaders).
- Odds player names are matched to batters accent/suffix-tolerantly; unmatched
  batters simply show no edge. `oddsStatus` may be `no_key` in a slate generated
  without an odds API key — the board still works model-first.
