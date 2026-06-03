/**
 * lineupPoller — detects when official batting orders are posted for today's games
 * and fires a notification for each newly confirmed lineup.
 *
 * Flow:
 *   checkForNewLineups()
 *     → fetch today's schedule with lineups hydration
 *     → compare each team's lineup state to what we last stored
 *     → for any team that just got confirmed, fire a notification
 *     → persist the updated state so we never double-notify
 *
 * Storage key: 'statfax_confirmed_lineups' → JSON array of "<gamePk>-<side>" strings
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_KEY = 'statfax_confirmed_lineups';
const MLB_BASE = 'https://statsapi.mlb.com/api/v1';

/**
 * Returns an array of newly confirmed lineups.
 * Each item: { awayAbbr, homeAbbr, side }  where side = 'away' | 'home'
 * Returns [] when nothing new is confirmed.
 */
export async function checkForNewLineups() {
  // Local YYYY-MM-DD (NOT UTC). UTC would shift to tomorrow's date for any
  // user west of UTC by mid-evening, missing tonight's lineup confirmations.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 1. Fetch today's schedule with lineups + team info
  let schedData;
  try {
    const res = await fetch(
      `${MLB_BASE}/schedule?sportId=1&date=${today}&hydrate=lineups,team`
    );
    if (!res.ok) return [];
    schedData = await res.json();
  } catch {
    return [];
  }

  const games = [];
  for (const dateEntry of schedData.dates || []) {
    for (const g of dateEntry.games || []) {
      games.push(g);
    }
  }
  if (!games.length) return [];

  // 2. Load the set of already-notified lineup keys
  let seen;
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    seen = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    seen = new Set();
  }

  // 3. Check each game / each side for a confirmed lineup
  const newLineups = [];

  for (const g of games) {
    const awayAbbr = g.teams?.away?.team?.abbreviation || '???';
    const homeAbbr = g.teams?.home?.team?.abbreviation || '???';
    const gamePk   = g.gamePk;

    const awayKey = `${gamePk}-away`;
    const homeKey = `${gamePk}-home`;

    const awayConfirmed = (g.lineups?.awayPlayers?.length ?? 0) > 0;
    const homeConfirmed = (g.lineups?.homePlayers?.length ?? 0) > 0;

    if (awayConfirmed && !seen.has(awayKey)) {
      seen.add(awayKey);
      // gamePk is required by the ELITE-pick-confirmed cross-reference in
      // App.js — without it `confirmedGames.has(...)` always misses.
      newLineups.push({ gamePk, awayAbbr, homeAbbr, side: 'away' });
    }

    if (homeConfirmed && !seen.has(homeKey)) {
      seen.add(homeKey);
      newLineups.push({ gamePk, awayAbbr, homeAbbr, side: 'home' });
    }
  }

  // 4. Persist updated seen set
  if (newLineups.length > 0) {
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen])).catch(() => {});
  }

  return newLineups;
}

/**
 * Clear the confirmed-lineups set — call at the start of each new day.
 */
export async function clearSeenLineups() {
  await AsyncStorage.removeItem(SEEN_KEY).catch(() => {});
}
