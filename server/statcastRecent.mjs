/**
 * statcastRecent.mjs — short-window (rolling) Statcast signals.
 *
 * Two recency signals that the season-long Savant percentile data misses:
 *
 *   1. Recent batted-ball quality (barrel% + avg EV over the last ~14 days).
 *      Per public research, short-window barrel rate is the single strongest
 *      7-14 day HR predictor — a batter whose season barrel is 8% but who's
 *      been barreling 15% over the last three weeks is far more dangerous than
 *      his season line suggests. Fetched in ONE league-wide statcast_search
 *      request (filtered to batted balls + a date range), then aggregated per
 *      batter — no per-player fetch loop, so it's cheap and low-risk.
 *
 *   2. Pitcher recent fastball velocity (last ~21 days). A starter throwing
 *      2+ mph below his norm is meaningfully more HR-vulnerable, and velo
 *      decline leads ERA/HR9 by 2-3 starts. Fetched per starting pitcher
 *      (only today's ~30 starters), bounded concurrency.
 *
 * Savant's CSV omits a `barrel` column, so barrels are derived from
 * launch_speed + launch_angle via the standard Statcast definition.
 *
 * All fetches fail soft → return {} so a Savant outage never breaks the slate.
 */

const SAVANT = 'https://baseballsavant.mlb.com';
const SAVANT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://baseballsavant.mlb.com/',
  Accept: 'text/csv, text/plain, */*',
};

// ─── CSV parse (handles quoted fields containing commas) ─────────────────────
function parseCsv(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!clean || clean.startsWith('<') || clean.startsWith('{')) return { header: [], rows: [] };
  const lines = clean.split('\n');
  if (lines.length < 2) return { header: [], rows: [] };
  const parseLine = (line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]).map(s => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    rows.push(parseLine(lines[i]));
  }
  return { header, rows };
}

// ─── Statcast barrel definition ──────────────────────────────────────────────
/**
 * A batted ball is a "barrel" when launch_speed ≥ 98 mph AND launch_angle sits
 * in a velocity-dependent window: at 98 mph the window is [26°, 30°], widening
 * ~1° per side for each additional mph, capped to [8°, 50°]. This reproduces
 * Statcast's barrel classification closely enough for a rate signal.
 */
export function isBarrel(ev, la) {
  if (!Number.isFinite(ev) || !Number.isFinite(la)) return false;
  if (ev < 98) return false;
  const widen = ev - 98;
  const lo = Math.max(8, 26 - widen);
  const hi = Math.min(50, 30 + widen);
  return la >= lo && la <= hi;
}

// ─── Date helper: subtract days from a YYYY-MM-DD string ─────────────────────
function minusDays(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

async function savantText(url) {
  try {
    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── 1) Recent batter barrels (one league-wide request) ──────────────────────
/**
 * @param {number} season
 * @param {{ windowDays?: number, endDate: string, minBBE?: number }} opts
 *   endDate — 'YYYY-MM-DD' (slate date, CT). Window is [endDate-windowDays, endDate].
 *   minBBE  — minimum batted-ball events before a batter's rate is trusted.
 * @returns {Promise<Record<number, { recentBarrelPct: number, recentEV: number, recentBBE: number }>>}
 */
export async function fetchRecentBatterBarrels(season, { windowDays = 14, endDate, minBBE = 8 } = {}) {
  const out = {};
  if (!endDate) return out;
  const start = minusDays(endDate, windowDays);
  const url =
    `${SAVANT}/statcast_search/csv` +
    `?all=true&hfGT=R%7C&hfSea=${season}%7C&player_type=batter` +
    `&hfBBT=fly_ball%7Cline_drive%7Cground_ball%7Cpopup%7C` +
    `&game_date_gt=${start}&game_date_lt=${endDate}` +
    `&min_pitches=0&min_results=0&type=details`;

  const text = await savantText(url);
  if (!text) return out;
  const { header, rows } = parseCsv(text);
  if (!rows.length) return out;

  const iBatter = header.indexOf('batter');
  const iEV     = header.indexOf('launch_speed');
  const iLA     = header.indexOf('launch_angle');
  if (iBatter < 0 || iEV < 0 || iLA < 0) return out;

  const agg = new Map(); // id -> { bbe, barrels, evSum }
  for (const r of rows) {
    const id = Number(r[iBatter]);
    if (!id) continue;
    const ev = parseFloat(r[iEV]);
    const la = parseFloat(r[iLA]);
    if (!Number.isFinite(ev)) continue;   // no contact reading → not a true BBE
    let a = agg.get(id);
    if (!a) { a = { bbe: 0, barrels: 0, evSum: 0 }; agg.set(id, a); }
    a.bbe++;
    a.evSum += ev;
    if (isBarrel(ev, la)) a.barrels++;
  }

  for (const [id, a] of agg) {
    if (a.bbe < minBBE) continue;
    out[id] = {
      recentBarrelPct: +(100 * a.barrels / a.bbe).toFixed(1),
      recentEV:        +(a.evSum / a.bbe).toFixed(1),
      recentBBE:       a.bbe,
    };
  }
  return out;
}

// ─── 2) Recent pitcher fastball velocity (per starter) ───────────────────────
const FASTBALLS = new Set(['FF', 'SI', 'FC', 'FT']); // 4-seam, sinker, cutter, 2-seam
// CSW = Called Strikes + Whiffs. A pitcher who racks up CSW controls counts →
// fewer hitter's counts (2-0/3-1) where HRs cluster. Computed for free from the
// `description` column of the same season-pitch CSV the velo trend fetches.
const CSW_DESC = new Set(['called_strike', 'swinging_strike', 'swinging_strike_blocked', 'foul_tip']);

async function fetchOnePitcherVeloTrend(pitcherId, season, recentCutoff) {
  // Fetch ALL season-to-date pitches for this pitcher (no date filter), then
  // split fastballs into recent (game_date >= recentCutoff) vs the full season
  // baseline in JS. One request gives both numbers, so the velo DELTA is the
  // pitcher's own norm — not a league average (a 97 mph arm sitting 94 is
  // declining; a 91 mph arm at 91 is fine).
  const url =
    `${SAVANT}/statcast_search/csv` +
    `?all=true&hfGT=R%7C&hfSea=${season}%7C&player_type=pitcher` +
    `&min_pitches=0&min_results=0&type=details` +
    `&pitchers_lookup%5B%5D=${pitcherId}`;
  const text = await savantText(url);
  if (!text) return null;
  const { header, rows } = parseCsv(text);
  if (!rows.length) return null;
  const iPT   = header.indexOf('pitch_type');
  const iVel  = header.indexOf('release_speed');
  const iDate = header.indexOf('game_date');
  const iDesc = header.indexOf('description');
  if (iPT < 0 || iVel < 0 || iDate < 0) return null;

  let seasonSum = 0, seasonN = 0, recentSum = 0, recentN = 0;
  let cswHits = 0, pitchTotal = 0;
  for (const r of rows) {
    if (iDesc >= 0) { pitchTotal++; if (CSW_DESC.has(r[iDesc])) cswHits++; }  // CSW over ALL pitch types
    if (!FASTBALLS.has(r[iPT])) continue;                                     // velo over fastballs only
    const v = parseFloat(r[iVel]);
    if (!Number.isFinite(v) || v < 70) continue;
    seasonSum += v; seasonN++;
    if ((r[iDate] || '') >= recentCutoff) { recentSum += v; recentN++; }
  }
  if (seasonN < 40 || recentN < 15) return null; // too thin to trust the trend
  const recentFastballVelo = +(recentSum / recentN).toFixed(1);
  const seasonFastballVelo = +(seasonSum / seasonN).toFixed(1);
  return {
    recentFastballVelo,
    seasonFastballVelo,
    veloDelta: +(recentFastballVelo - seasonFastballVelo).toFixed(1),
    recentFastballs: recentN,
    seasonCswPct: pitchTotal >= 100 ? +(100 * cswHits / pitchTotal).toFixed(1) : null,
  };
}

/**
 * Fetches recent batter barrels for both a 7-day and a 14-day window in
 * parallel. The two aggregates are anchor points for exponential time-decay
 * weighting in ProbabilityEngine.js:
 *   W_d = e^(-0.1 × d) — 7d mid (d≈3.5) → 0.704, 8-14d mid (d≈10.5) → 0.351
 *   Normalised: 7d ≈ 0.667 weight, 8-14d gap ≈ 0.333 weight.
 *
 * @returns {Promise<{sevenDay: Record, fourteenDay: Record}>}
 */
export async function fetchRecentBatterBarrelsMultiWindow(season, { endDate, minBBE = 8 } = {}) {
  if (!endDate) return { sevenDay: {}, fourteenDay: {} };
  const [sevenDay, fourteenDay] = await Promise.all([
    fetchRecentBatterBarrels(season, { windowDays: 7,  endDate, minBBE: Math.max(3, Math.floor(minBBE / 2)) }),
    fetchRecentBatterBarrels(season, { windowDays: 14, endDate, minBBE }),
  ]);
  return { sevenDay, fourteenDay };
}

/**
 * @param {number[]} pitcherIds  today's starting pitcher ids
 * @param {number} season
 * @param {{ windowDays?: number, endDate: string, concurrency?: number }} opts
 * @returns {Promise<Record<number, { recentFastballVelo, seasonFastballVelo, veloDelta, recentFastballs }>>}
 */
export async function fetchRecentPitcherVelo(pitcherIds, season, { windowDays = 21, endDate, concurrency = 4 } = {}) {
  const out = {};
  if (!endDate || !Array.isArray(pitcherIds) || !pitcherIds.length) return out;
  const recentCutoff = minusDays(endDate, windowDays);
  const ids = [...new Set(pitcherIds.filter(Boolean))];

  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const id = ids[idx++];
      const res = await fetchOnePitcherVeloTrend(id, season, recentCutoff);
      if (res) out[id] = res;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}
