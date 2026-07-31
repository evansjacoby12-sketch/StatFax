import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULTS = Object.freeze({
  site: process.env.DOCTOR_SITE_URL || 'https://statfax.online',
  r2: process.env.DOCTOR_R2_URL || 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev',
  worker: process.env.DOCTOR_WORKER_URL || 'https://statfax-cron.evansjacoby12.workers.dev',
  repo: process.env.DOCTOR_GITHUB_REPO || 'evansjacoby12-sketch/StatFax',
  maxSlateAgeMinutes: Number(process.env.DOCTOR_MAX_SLATE_AGE_MINUTES || 50),
})

const REQUIRED_GITHUB_SECRETS = Object.freeze([
  'ODDS_API_KEY',
  'OPENAI_API_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_ACCOUNT_ID',
  'R2_SECRET_ACCESS_KEY',
  'TAVILY_API_KEY',
])
const REQUIRED_WORKER_SECRETS = Object.freeze(['GITHUB_TOKEN', 'OPENAI_API_KEY'])

function finiteDate(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function assessFreshness(value, now = new Date(), maxAgeMinutes = 50) {
  const timestamp = finiteDate(value)
  const current = now instanceof Date ? now.getTime() : finiteDate(now)
  if (timestamp == null || current == null) return { ok: false, ageMinutes: null, reason: 'invalid timestamp' }
  const ageMinutes = Math.max(0, (current - timestamp) / 60_000)
  return {
    ok: ageMinutes <= maxAgeMinutes,
    ageMinutes: Math.round(ageMinutes * 10) / 10,
    reason: ageMinutes <= maxAgeMinutes ? 'fresh' : `older than ${maxAgeMinutes} minutes`,
  }
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'statfax-doctor/1' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function localJsonCheck(root, relativePath) {
  const absolute = path.join(root, relativePath)
  if (!fs.existsSync(absolute)) return { ok: false, detail: `${relativePath} is missing` }
  try {
    const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'))
    return { ok: parsed && typeof parsed === 'object', detail: `${relativePath} is valid JSON` }
  } catch (error) {
    return { ok: false, detail: `${relativePath}: ${error.message}` }
  }
}

function summary(checks) {
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  }
}

export async function runDoctor({
  fetchImpl = globalThis.fetch,
  now = new Date(),
  root = ROOT,
  offline = false,
  config = DEFAULTS,
} = {}) {
  const checks = []
  const add = (id, status, detail, data = null) => checks.push({ id, status, detail, ...(data ? { data } : {}) })

  const nodeMajor = Number(process.versions.node.split('.')[0])
  add('node', nodeMajor >= 22 ? 'pass' : 'fail', `Node ${process.versions.node}; version 22+ required`)

  for (const relativePath of ['package.json', 'ui/package.json', '.github/workflows/deploy.yml']) {
    add(`file:${relativePath}`, fs.existsSync(path.join(root, relativePath)) ? 'pass' : 'fail', `${relativePath} ${fs.existsSync(path.join(root, relativePath)) ? 'present' : 'missing'}`)
  }
  const backtest = localJsonCheck(root, 'dist/backtest-log.json')
  add('local:backtest-log', backtest.ok ? 'pass' : 'warn', backtest.detail)

  if (!offline) {
    const targets = await Promise.allSettled([
      fetchJson(fetchImpl, `${config.site}/version.json?t=${now.getTime()}`),
      fetchJson(fetchImpl, `${config.site}/data/mlb-data-health.json?t=${now.getTime()}`),
      fetchJson(fetchImpl, `${config.r2}/mlb-data-health.json?t=${now.getTime()}`),
      fetchJson(fetchImpl, `${config.worker}/health?t=${now.getTime()}`),
      fetchJson(fetchImpl, `https://api.github.com/repos/${config.repo}/actions/workflows/deploy.yml/runs?per_page=8`),
    ])
    const [versionResult, siteHealthResult, r2HealthResult, workerResult, runsResult] = targets

    if (versionResult.status === 'fulfilled') {
      const version = versionResult.value
      add('site:version', version.sha && version.builtAt ? 'pass' : 'fail', version.sha ? `deployed ${String(version.sha).slice(0, 7)} at ${version.builtAt}` : 'version metadata incomplete', version)
    } else add('site:version', 'fail', `unreachable: ${versionResult.reason?.message || versionResult.reason}`)

    const healthRows = [
      ['site:slate', siteHealthResult],
      ['r2:slate', r2HealthResult],
    ]
    for (const [id, result] of healthRows) {
      if (result.status === 'rejected') {
        add(id, 'fail', `unreachable: ${result.reason?.message || result.reason}`)
        continue
      }
      const health = result.value
      const freshness = assessFreshness(health.slateGeneratedAt, now, config.maxSlateAgeMinutes)
      const hardFailures = Number(health.counts?.hardFailures || 0)
      const warnings = Number(health.counts?.warnings || 0)
      const status = hardFailures > 0 || !freshness.ok ? 'fail' : warnings > 0 || health.status !== 'healthy' ? 'warn' : 'pass'
      add(id, status, `${freshness.ageMinutes ?? '?'}m old; ${hardFailures} blocker(s), ${warnings} warning(s); ${health.status || 'unknown'}`, { freshness, status: health.status, counts: health.counts })
    }

    if (siteHealthResult.status === 'fulfilled' && r2HealthResult.status === 'fulfilled') {
      const siteAt = finiteDate(siteHealthResult.value.slateGeneratedAt)
      const r2At = finiteDate(r2HealthResult.value.slateGeneratedAt)
      const delta = siteAt != null && r2At != null ? Math.abs(siteAt - r2At) / 60_000 : Infinity
      add('publish:parity', delta <= 5 ? 'pass' : 'warn', Number.isFinite(delta) ? `site/R2 slate timestamps differ by ${delta.toFixed(1)}m` : 'site/R2 timestamps unavailable')
    }

    if (workerResult.status === 'fulfilled') {
      const worker = workerResult.value
      const missing = Object.entries(worker.checks || {}).filter(([, value]) => value !== true).map(([key]) => key)
      add('worker:health', worker.ok && !missing.length ? 'pass' : 'fail', missing.length ? `missing: ${missing.join(', ')}` : 'dispatch, AI, and rate limits configured', worker.checks)
    } else add('worker:health', 'fail', `unreachable: ${workerResult.reason?.message || workerResult.reason}`)

    if (runsResult.status === 'fulfilled') {
      const runs = Array.isArray(runsResult.value.workflow_runs) ? runsResult.value.workflow_runs : []
      const latest = runs.find((run) => !['cancelled', 'skipped'].includes(run.conclusion))
      if (!latest) add('github:deploy', 'fail', 'no deploy workflow runs returned')
      else if (latest.status !== 'completed') add('github:deploy', 'warn', `latest run is ${latest.status}`, { url: latest.html_url, headSha: latest.head_sha })
      else add('github:deploy', latest.conclusion === 'success' ? 'pass' : 'fail', `latest completed run: ${latest.conclusion}`, { url: latest.html_url, headSha: latest.head_sha })
    } else add('github:deploy', 'fail', `unreachable: ${runsResult.reason?.message || runsResult.reason}`)
  }

  const counts = summary(checks)
  return {
    version: 1,
    checkedAt: now.toISOString(),
    status: counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass',
    offline,
    counts,
    checks,
    credentialInventory: {
      githubSecrets: REQUIRED_GITHUB_SECRETS,
      workerSecrets: REQUIRED_WORKER_SECRETS,
      note: 'Names only. The doctor never reads or prints secret values.',
    },
  }
}

export function formatDoctor(report) {
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }
  const lines = [`STATFAX DOCTOR: ${report.status.toUpperCase()} (${report.counts.pass} pass, ${report.counts.warn} warn, ${report.counts.fail} fail)`]
  for (const check of report.checks) lines.push(`[${icon[check.status]}] ${check.id}: ${check.detail}`)
  lines.push(`GitHub secrets: ${report.credentialInventory.githubSecrets.join(', ')}`)
  lines.push(`Worker secrets: ${report.credentialInventory.workerSecrets.join(', ')}`)
  lines.push(report.credentialInventory.note)
  return lines.join('\n')
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const report = await runDoctor({ offline: args.has('--offline') })
  console.log(args.has('--json') ? JSON.stringify(report, null, 2) : formatDoctor(report))
  process.exitCode = report.status === 'fail' ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[doctor] ${error.stack || error.message}`)
    process.exitCode = 1
  })
}
