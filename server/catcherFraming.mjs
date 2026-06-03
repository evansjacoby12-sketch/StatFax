/**
 * catcherFraming.mjs — Savant catcher-framing leaderboard fetcher.
 *
 * Catcher framing (the ability to steal called strikes) shifts a pitcher's
 * effective count distribution. An elite framer turns borderline pitches into
 * strikes, pushing counts pitcher-friendly (0-2, 1-2) where HR rate is lowest.
 * A poor framer does the opposite: borderline pitches go as balls, pushing
 * counts hitter-friendly (3-1, 2-0, 3-2) where batters swing harder and HR
 * rate climbs. The effect is modest (~0.5% HR9 per framing run) but consistent
 * — framing skill is stable year-to-year unlike batted-ball luck.
 *
 * Returns: { [catcherId: number]: { framingRuns: number, framingPct: number } }
 *   framingRuns  — runs_extra_strikes, typical range -10 to +15
 *   framingPct   — strike_rate on non-zone pitches, typical 0.45 to 0.55
 */

const SAVANT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://baseballsavant.mlb.com/',
  Accept: 'text/csv, text/plain, */*',
};

async function savantCSV(url) {
  try {
    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) return [];
    const raw  = await res.text();
    const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!text || text.startsWith('<') || text.startsWith('{')) return [];

    const lines = text.split('\n');
    if (lines.length < 2) return [];

    const parseRow = (line) => {
      const vals = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (c === ',' && !inQ) {
          vals.push(cur); cur = '';
        } else {
          cur += c;
        }
      }
      vals.push(cur);
      return vals;
    };

    const headers = parseRow(lines[0]);
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = parseRow(line);
      const obj  = {};
      headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim(); });
      return obj;
    });
  } catch {
    return [];
  }
}

/**
 * Fetch catcher framing data for the given season year.
 *
 * @param {number} year  MLB season year (e.g. 2025)
 * @returns {Promise<Record<number, { framingRuns: number, framingPct: number }>>}
 */
export async function fetchCatcherFraming(year) {
  const out = {};
  try {
    const rows = await savantCSV(
      `https://baseballsavant.mlb.com/leaderboard/catcher-framing` +
      `?year=${year}&team=&min=q&csv=true`
    );
    const pf = v => (v != null && v !== '' ? parseFloat(v) : null);
    for (const r of rows) {
      // Savant's catcher-framing CSV ships columns id / rv_tot / pct_tot — NOT
      // player_id / runs_extra_strikes / strike_rate. The old names matched
      // nothing, so Number(undefined)=NaN skipped EVERY row and the framing map
      // shipped empty every run (which is why the framing signal never fired).
      const id = Number(r.id);
      if (!id) continue;
      const framingRuns = pf(r.rv_tot);   // total framing run value (≈ runs_extra_strikes)
      const framingPct  = pf(r.pct_tot);  // overall strike rate on framing chances
      if (framingRuns == null && framingPct == null) continue;
      out[id] = { framingRuns: framingRuns ?? 0, framingPct: framingPct ?? 0 };
    }
    return out;
  } catch {
    return out;
  }
}
