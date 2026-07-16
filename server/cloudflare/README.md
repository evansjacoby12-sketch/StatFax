# StatFax cron Worker

A tiny Cloudflare Worker that fires every 10 minutes and pokes the
`slate-cron` GitHub workflow via `repository_dispatch`. Exists because
GitHub Actions' own scheduled-event trigger is unreliable on private
free-tier repos — we were seeing 4–8 runs/day with multi-hour gaps when
asking for every 10 minutes.

The Worker is ~80 lines and does one thing: POST to GitHub's
`/repos/{owner}/{repo}/dispatches` endpoint. The actual slate-fetching
still happens on GitHub Actions runners — this just gives them a
reliable heartbeat.

---

## One-time setup

### 1. Create a GitHub Personal Access Token

Go to <https://github.com/settings/personal-access-tokens> → **Generate
new token** → **Fine-grained tokens**.

- **Token name:** `statfax-cron-worker` (or whatever)
- **Resource owner:** your account
- **Repository access:** Only select repositories → `StatFax`
- **Repository permissions:**
  - **Contents:** Read and write  *(what `repository_dispatch` actually checks)*
  - **Metadata:** Read-only *(required — fine-grained tokens always need this)*
- **Expiration:** longest available (or no-expiry if your org allows)

Copy the `github_pat_...` token. You'll paste it once into Cloudflare
and never need it again until rotation.

### 2. Install wrangler if you don't have it

```sh
npm install -g wrangler
```

### 3. Authenticate

```sh
cd server/cloudflare
wrangler login           # opens a browser to your CF account
```

### 4. Set the GitHub token as a Worker secret

```sh
wrangler secret put GITHUB_TOKEN
# paste your github_pat_... when prompted, hit enter
```

### 5. Deploy

```sh
wrangler deploy
```

You'll get a URL like `https://statfax-cron.<your-sub>.workers.dev`.
Hit `GET /` in a browser to manually test the trigger — should return
`OK — dispatched slate-refresh at <timestamp>`.

---

## Verifying it works

1. Tail the Worker logs:
   ```sh
   wrangler tail
   ```
   Wait up to 10 min — you'll see `Dispatched slate-refresh to ...` log
   lines on every cron fire.

2. Check GitHub Actions:
   ```sh
   gh run list --workflow=slate-cron.yml --event=repository_dispatch --limit=10
   ```
   You should see new runs with `repository_dispatch` as the event
   roughly every 10 minutes.

---

## HTTP endpoints

Besides the cron trigger, the Worker serves a few small `fetch` routes the
app calls directly from the browser:

| Route | Method | Purpose |
| --- | --- | --- |
| `/` or `/trigger` | GET | Manually fire a slate refresh (returns plain text). |
| `/parse` | POST | Natural-language → backtest filter chips (Signal Backtest UI). |
| `/list-builder` | POST | Natural-language → visible, editable List Builder criteria. |
| `/list-builder-analyst` | POST | Aggregate-only List Builder diagnosis, recipe comparison, and one allow-listed safe relaxation. |
| `/explain` | POST | Structured Case-vs-Caution player explanation; legacy paragraph narration for combos. |
| `/savant-bip` | GET | CORS proxy for Baseball Savant batted-ball data (spray chart). |

`/parse`, `/list-builder`, `/list-builder-analyst`, and `/explain` use OpenAI structured outputs, so they need an OpenAI
key set as a Worker secret:

```sh
wrangler secret put OPENAI_API_KEY
# paste your OpenAI API key when prompted
```

All four are **narration/configuration-only** — they translate English ↔ existing model
output and never see raw data, do math, or influence any prediction. The
HR scores are computed deterministically on GitHub Actions before the app
ever loads, so the Worker cannot change a grade or probability. Optional:
set `OPENAI_MODEL` (Worker var) to override the default cost-sensitive model, and
`ALLOW_ORIGIN` to lock CORS to your site instead of `*`.

The browser reaches these via `VITE_WORKER_URL` (set at UI build time to the
deployed `*.workers.dev` URL). When it's unset, the app degrades gracefully:
the Explain button and Savant spray chart simply don't render.

---

## Why both schedule AND repository_dispatch?

The GitHub workflow keeps its `schedule: */10 * * * *` trigger as a
secondary heartbeat. If the Worker ever silently dies (CF outage,
billing issue, token expiry), GitHub's own scheduler will still
occasionally fire — sparsely, but it's a survivable degraded mode rather
than zero updates. With both triggers active, runs are de-duplicated
naturally because `concurrency.cancel-in-progress: false` queues
overlapping runs serially and the snapshot is idempotent.

---

## Cost

Cloudflare Workers free tier:
- 100,000 requests/day  (we use ~144 cron fires/day → well under)
- Cron triggers are free with no separate limit
- $0/month

---

## Rotating the token

When the GitHub PAT expires or you want to rotate:

```sh
wrangler secret put GITHUB_TOKEN
# paste the new token
```

No redeploy needed — secret updates take effect within seconds.

---

## Removing the Worker

```sh
wrangler delete
```

The GitHub workflow keeps working off its `schedule` trigger (sparsely)
and `workflow_dispatch` (manually). The app keeps functioning, just
with stale snapshots more often.
