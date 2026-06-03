/**
 * statcastExpected.mjs
 *
 * Fetches Baseball Savant expected-statistics leaderboard for qualified batters.
 * Returns xBA, xSLG, xISO (derived), xwOBA, bbPct, and kPct keyed by MLB player_id.
 * These are the highest-value short-window HR predictors: xISO + barrel% + xSLG.
 * On any network or parse failure, returns {} so the cron never crashes.
 */

const SAVANT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://baseballsavant.mlb.com/',
  Accept: 'text/csv, text/plain, */*',
};

/**
 * Parse a Baseball Savant CSV download endpoint.
 * Returns an array of row-objects (header → value), [] on any failure.
 * @param {string} url
 * @returns {Promise<Array<Record<string,string>>>}
 */
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
 * Fetch Savant expected-statistics for all qualified batters in a given season.
 *
 * @param {number} year - MLB season year (e.g. 2025)
 * @returns {Promise<Record<number, {
 *   xBA:   number|null,
 *   xSLG:  number|null,
 *   xISO:  number|null,
 *   xwOBA: number|null,
 *   bbPct: number|null,
 *   kPct:  number|null,
 * }>>}
 */
export async function fetchBatterExpectedStats(year) {
  const out = {};
  // Coerce Savant field to float, or null for blank/missing values.
  const pf = v => (v != null && v !== '' ? parseFloat(v) : null);

  try {
    const rows = await savantCSV(
      `https://baseballsavant.mlb.com/leaderboard/expected_statistics` +
      `?type=batter&year=${year}&position=&team=&min=q&csv=true`
    );

    for (const p of rows) {
      const id = Number(p.player_id);
      if (!id) continue;

      const xBA  = pf(p.est_ba);
      const xSLG = pf(p.est_slg);

      // xISO = xSLG - xBA: isolates extra-base power by removing singles
      // from the slugging equation, leaving a cleaner HR-signal.
      const xISO = (xSLG != null && xBA != null) ? xSLG - xBA : null;

      out[id] = {
        xBA,
        xSLG,
        xISO,
        xwOBA: pf(p.est_woba),
        bbPct: pf(p.bb_percent),
        kPct:  pf(p.k_percent),
      };
    }

    return out;
  } catch {
    return out;
  }
}
