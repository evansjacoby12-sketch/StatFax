# StatFax operations runbook

This is the owner checklist for keeping StatFax running without relying on chat history. Commands assume PowerShell from the repository root.

## Fast health check

```powershell
npm install
npm run doctor
gh run list --workflow deploy.yml --limit 5
```

`doctor` checks the local runtime, production site, R2 slate, Worker configuration, publish parity, and latest deploy. `WARN` is operational but deserves review; `FAIL` exits nonzero.

Direct endpoints:

- Site: `https://statfax.online`
- Worker: `https://statfax-cron.evansjacoby12.workers.dev/health`
- Durable MLB health: `https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/mlb-data-health.json`
- GitHub workflow: `.github/workflows/deploy.yml`

## Normal production flow

Cloudflare cron fires every 10 minutes, sends `repository_dispatch`, and GitHub Actions builds the slate. The workflow validates data before publishing to R2 and GitHub Pages. GitHub cache accelerates builds; R2 is the durable recovery source. A dated MLB archive is written to `mlb/archive/YYYY-MM-DD/` after each successful production publish.

Manually start and watch a build:

```powershell
gh workflow run deploy.yml --ref main
gh run list --workflow deploy.yml --limit 1
gh run watch <run-id> --exit-status
```

Inspect a failure:

```powershell
gh run view <run-id> --log-failed
npm run doctor -- --json
```

Do not repeatedly press Build Slate while a run is active. Workflow concurrency intentionally lets the current run finish.

## MLB artifact safety

Audit what is locally usable:

```powershell
npm run mlb:audit
```

Create a validated local snapshot before risky data work:

```powershell
npm run mlb:archive
```

Recover missing state from current R2:

```powershell
npm run mlb:recover -- --missing-only
```

Recover the published snapshot for a particular date:

```powershell
$env:MLB_R2_ARCHIVE_DATE="2026-07-31"
npm run mlb:recover
Remove-Item Env:MLB_R2_ARCHIVE_DATE
```

Rollback to the newest local snapshot, or a specific snapshot ID printed by `mlb:archive`:

```powershell
npm run mlb:rollback
npm run mlb:rollback -- <snapshot-id>
```

Recovery and rollback validate JSON and critical shapes before atomic writes. They only touch the allow-listed MLB artifacts. `dist/backtest-log.json` is the only tracked `dist` file; do not broadly add generated `dist` content to Git.

## Incident playbooks

### Build failed

1. Run `gh run view <run-id> --log-failed`.
2. If restore/recovery failed, run `npm run mlb:recover -- --missing-only` locally and `npm run mlb:audit`.
3. If a data contract failed, do not bypass the validator. Fix the source or restore a known-good artifact.
4. Run `npm test` and `npm --prefix ui run smoke` before pushing.
5. Re-run the workflow once.

### Slate is stale

1. Check Worker `/health`; every required check must be `true`.
2. Check the latest GitHub run and whether another run is in progress.
3. Open R2 `mlb-data-health.json`; inspect `slateGeneratedAt`, hard failures, and warnings.
4. Manually dispatch one workflow run.
5. If GitHub never receives it, rotate/re-add the Worker `GITHUB_TOKEN`, deploy the Worker, and test `/trigger`.

For an NFL-only stale slate, compare the deployed `data/nfl/daily.json` timestamp with the latest workflow run and run `npm run nfl:audit`. During preseason, also inspect `nfl/preseason.json` in R2: completed games should have final observations and role summaries, while preseason results must remain excluded from regular-season calibration.

If the latest deploy remains queued because an older run is stuck in `waiting` on the Pages environment, cancel only that oldest waiting run, then allow the newest queued run to proceed. Do not mass-cancel active refreshes. Afterward, confirm the NFL snapshot timestamp advanced, run `npm run doctor`, and verify publish parity.

### Site failed but R2 is current

This usually means Pages deployment failed after data publication. Re-run the workflow. The deploy step already retries twice with backoff; model data does not need to be recomputed manually.

### API/AI degraded

OpenAI narration and filter-translation features degrade separately from deterministic core scoring. Keep the slate running, check provider usage and billing, then inspect the brief and browser AI endpoints. AI does not adjust HR probability.

## Secrets and service inventory

GitHub repository secrets:

- `SITE_PASSWORD_SHA256` (required; SHA-256 of the quick shared site password)
- `ODDS_API_KEY`
- `OPENAI_API_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_ACCOUNT_ID`
- `R2_SECRET_ACCESS_KEY`
- optional `ALERT_WEBHOOK_URL`

GitHub repository variables:

- required durable-store configuration: `R2_BUCKET`
- optional model/UI controls: `BRIEF_MODEL`, `ODDS_REFRESH_MINUTES`, `VITE_PARSE_URL`, `VITE_WORKER_URL`
- NFL controls: `NFL_TARGET_SEASON`, `NFL_TARGET_SEASON_TYPE`, `NFL_TARGET_WEEK`

Cloudflare Worker secrets:

- `GITHUB_TOKEN`
- `OPENAI_API_KEY`
- optional `ALERT_WEBHOOK_URL`

Set secrets interactively; never paste their values into code, issues, logs, or chat:

```powershell
gh secret set OPENAI_API_KEY
gh secret set ALERT_WEBHOOK_URL
Set-Location server/cloudflare
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ALERT_WEBHOOK_URL
npx wrangler deploy
```

### Quick shared site password

Production builds fail closed unless the repository secret `SITE_PASSWORD_SHA256` contains a lowercase, 64-character SHA-256 hash. The plaintext password is never stored in the repository or GitHub Actions configuration. Generate and save the hash from a private PowerShell prompt:

```powershell
$secure = Read-Host "New StatFax shared password" -AsSecureString
$plain = [Net.NetworkCredential]::new('', $secure).Password
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$sha256 = [Security.Cryptography.SHA256]::Create()
$hash = -join ($sha256.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
$hash | gh secret set SITE_PASSWORD_SHA256
$sha256.Dispose()
$plain = $null; $hash = $null; $secure = $null
```

Then deploy and verify the locked screen appears before any model board or slate request:

```powershell
gh workflow run deploy.yml --ref main
gh run list --workflow deploy.yml --limit 1
```

The quick lock is a client-side privacy screen, not server-side authentication: a determined visitor can inspect the static bundle or request public Pages artifacts directly. Use Cloudflare Access or private hosting if the data itself must be inaccessible. Changing the shared password invalidates existing browser sessions after the new deployment because the stored hash no longer matches.

The Worker accepts only approved production/local origins and rate-limits paid AI and Savant routes. `ALERT_WEBHOOK_URL` accepts a Discord/Slack-compatible JSON webhook. Without it, Worker health reports alerts as optional/unconfigured and GitHub's built-in failure notification remains active.

Rotate a leaked key at the provider first, then replace the GitHub and/or Worker secret, deploy, and run `doctor`. Removing a secret from GitHub does not revoke the provider key.

## Cost controls outside the repository

The code cannot set provider account budgets. In the OpenAI dashboard, set a monthly budget and email alerts, restrict keys to this project where supported, and review usage weekly. Rate limiting protects public endpoints but is not a substitute for provider-side spend limits.

## Release verification

Before declaring a release safe:

```powershell
npm install
npm run doctor -- --offline
npm run mlb:recover -- --missing-only
npm run mlb:audit
npm test
npm --prefix ui install
npm --prefix ui run smoke
npm --prefix ui run build
npm run doctor
```

Then confirm the latest GitHub production run succeeded and the deployed `version.json` matches the expected commit.
