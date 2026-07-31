# Deploying StatFax

Production is a static React UI plus validated JSON snapshots. GitHub Actions builds both; Cloudflare R2 holds durable/current data; GitHub Pages serves `statfax.online`; a Cloudflare Worker triggers refreshes and serves protected AI/data proxy routes.

## Production topology

```text
Cloudflare Worker cron (every 10 minutes)
  -> GitHub repository_dispatch
  -> .github/workflows/deploy.yml
     -> restore cache + recover missing R2 state
     -> reconcile, build models, fetch slate
     -> validate all data contracts
     -> publish current R2 artifacts + dated MLB archive
     -> smoke/build UI
     -> deploy GitHub Pages
```

GitHub's own schedules remain as best-effort backups. Workflow concurrency lets one active deployment finish instead of cancelling it.

## One-time GitHub setup

1. Set Pages source to **GitHub Actions**.
2. Add repository variable `R2_BUCKET`.
3. Add the GitHub secrets listed in [`OPS.md`](OPS.md#secrets-and-service-inventory).
4. Run **Build slate + deploy** from the Actions tab.
5. Confirm `npm run doctor` reports current site/R2 timestamps and a successful workflow.

Do not put secret values in repository variables or `.env.example`.

## Cloudflare Worker

The Worker source and configuration live under `server/cloudflare/`.

```powershell
Set-Location server/cloudflare
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```

Optional operational webhook:

```powershell
npx wrangler secret put ALERT_WEBHOOK_URL
npx wrangler deploy
```

Verify `https://statfax-cron.evansjacoby12.workers.dev/health`. Required checks must be true. `alertsConfigured` may be false if webhook alerts are not desired.

## Manual release

```powershell
gh workflow run deploy.yml --ref main
gh run list --workflow deploy.yml --limit 1
gh run watch <run-id> --exit-status
npm run doctor
```

The workflow blocks on data validation, production R2 publication, UI smoke tests, build, and final Pages deployment. Pages deployment has two backoff retries. An optional failure job posts to `ALERT_WEBHOOK_URL`.

## Local mode

```powershell
npm install
npm run build-model
npm run slate
npm --prefix ui install
npm --prefix ui run dev
```

Or run `StatFax.bat` for the existing local auto-refresh server. Optional paid enrichments require the keys documented in `.env.example`; deterministic core behavior degrades safely when an optional provider is absent.

## Recovery

GitHub cache is not the system of record. The workflow recovers missing MLB state from R2 before building and publishes a dated archive after validation. Use:

```powershell
npm run mlb:audit
npm run mlb:recover -- --missing-only
```

Full rollback, stale slate, and failed-build instructions are in [`OPS.md`](OPS.md).

## What the build contains

`npm --prefix ui run build` copies the current MLB/NFL JSON assets needed by the configured Vite build into `ui/dist`. The resulting board is static; browser AI calls go only through the origin-gated/rate-limited Worker.
