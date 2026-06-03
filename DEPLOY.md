# Deploying StatFax

The app is a **static UI** (`ui/dist`) plus a **data snapshot** (`dist/daily.json`,
`dist/backtest-log.json`) that the slate regenerates from live MLB data. So a host
needs to (a) serve static files and (b) run the slate on a schedule.

## Option A — GitHub Pages (free, recommended) ✅

A workflow is already included: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
It runs the slate on a cron, builds the UI, and publishes to Pages.

**One-time setup:**
1. Create a GitHub repo and push this project (a **public** repo gets unlimited
   Actions minutes; for a private repo, trim the `schedule:` cron in the workflow).
2. On GitHub: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.
3. Push to `main` (or run the workflow manually from the Actions tab). The first
   run deploys; the URL is shown in the Actions run and under Settings → Pages.

**How it stays fresh:** the cron (`*/30 14-23,0-5 * * *` UTC ≈ 10am–1am ET) re-runs
the slate every ~30 min and redeploys. The rolling backtest/calibration log
persists across runs via Actions cache, **seeded** by the committed
`dist/backtest-log.json`. No keys or secrets are required (the slate uses public
MLB Stats API + Baseball Savant).

> The UI builds with a **relative base**, so it works whether Pages serves it at
> a root domain or a `…/your-repo/` subpath — no config needed.

## Option B — Always-on locally (no GitHub) ✅

```bash
StatFax.bat        # builds the UI, then `npm run serve` (auto-refreshes every 20 min)
```
Point ngrok (or any tunnel) at **port 5180** for a phone-accessible URL. See the
[UI README](ui/README.md). This is the zero-cloud path you're already using.

## Option C — Cloudflare Pages / Netlify / Vercel

These host the static `ui/dist` at a root URL (relative base works as-is), but they
can't run the slate on their own schedule. Easiest combo: keep the GitHub Action to
**run the slate** and have it deploy to the host of your choice (swap the
`deploy-pages` step for the host's deploy action/CLI), or use the
`server/cloudflare/` Worker scaffold for a Workers-based publish.

## What the build contains
`npm --prefix ui run build` copies `daily.json`, `backtest-log.json`, and
`calibration.json` into `ui/dist/data/`, so the deployed site is a fully
self-contained snapshot (the board, Games, and Results views all work offline).
