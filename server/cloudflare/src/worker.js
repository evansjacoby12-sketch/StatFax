/**
 * StatFax slate-cron trigger Worker
 * ─────────────────────────────────
 * Fires every 10 minutes via Cloudflare's cron scheduler and pokes the
 * `slate-cron` GitHub workflow via `repository_dispatch`. The actual
 * fetch-slate.mjs work still happens on GitHub Actions runners — this
 * Worker just provides the reliable heartbeat that GitHub's own
 * scheduled-event trigger conspicuously does not.
 *
 * Why: GitHub Actions' `schedule` trigger on private free-tier repos is
 * heavily throttled. Empirically we were getting ~4-8 runs/day with
 * multi-hour gaps when asking for every 10 minutes (144/day). External
 * cron + `repository_dispatch` solves this — Cloudflare's Worker cron is
 * a hard guarantee (give or take a few seconds), and `repository_dispatch`
 * has no rate-limiting issues at this volume.
 *
 * Deployment: see README.md in this directory.
 *
 * Required Worker secrets (set via `wrangler secret put`):
 *   GITHUB_TOKEN  — fine-grained PAT with Actions: write on this repo
 *
 * Required Worker vars (set in wrangler.toml or dashboard):
 *   GITHUB_REPO   — "owner/repo" (e.g. "evansjacoby12-sketch/HRSauce")
 *   EVENT_TYPE    — repository_dispatch event_type to fire
 *                   (matches the workflow's `on.repository_dispatch.types`)
 */

export default {
  /**
   * Cloudflare invokes this on the cron schedule defined in wrangler.toml.
   * We POST to GitHub's dispatches endpoint; the workflow's `on:
   * repository_dispatch` trigger picks it up and runs.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerSlateRefresh(env));
  },

  /**
   * Manual test trigger — `curl https://<worker>.workers.dev/` from a
   * browser or terminal to verify the Worker can reach GitHub end-to-end.
   * Returns plain text so it's easy to eyeball.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/trigger') {
      return new Response('Not found', { status: 404 });
    }
    const result = await triggerSlateRefresh(env);
    return new Response(
      result.ok
        ? `OK — dispatched ${env.EVENT_TYPE || 'slate-refresh'} at ${new Date().toISOString()}\n`
        : `FAIL — ${result.status}: ${result.body}\n`,
      {
        status: result.ok ? 200 : 502,
        headers: { 'Content-Type': 'text/plain' },
      }
    );
  },
};

/**
 * POST to GitHub's repository_dispatch endpoint.
 *
 * Returns `{ ok, status, body }` so the manual-trigger path can surface
 * the error to the caller; the scheduled path just fire-and-forgets but
 * logs failures to Cloudflare's Worker logs for tailing with
 * `wrangler tail`.
 */
async function triggerSlateRefresh(env) {
  const repo      = env.GITHUB_REPO || 'evansjacoby12-sketch/HRSauce';
  const eventType = env.EVENT_TYPE  || 'slate-refresh';
  const token     = env.GITHUB_TOKEN;

  if (!token) {
    console.error('Missing GITHUB_TOKEN secret');
    return { ok: false, status: 500, body: 'Missing GITHUB_TOKEN secret' };
  }

  const url = `https://api.github.com/repos/${repo}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization':         `Bearer ${token}`,
      'Accept':                'application/vnd.github+json',
      'X-GitHub-Api-Version':  '2022-11-28',
      'User-Agent':            'statfax-cron-worker',
      'Content-Type':          'application/json',
    },
    body: JSON.stringify({
      event_type:     eventType,
      // Optional client payload — surfaces in the workflow run as
      // ${{ github.event.client_payload.* }} for debugging.
      client_payload: { triggeredAt: new Date().toISOString(), via: 'cf-worker-cron' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`GitHub dispatch failed ${res.status}: ${body}`);
    return { ok: false, status: res.status, body };
  }
  // 204 No Content on success — no body to read.
  console.log(`Dispatched ${eventType} to ${repo}`);
  return { ok: true, status: res.status, body: '' };
}
