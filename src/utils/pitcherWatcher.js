/**
 * pitcherWatcher — detects when a scheduled starting pitcher is replaced.
 *
 * Flow:
 *   storePitchers(games)          → called when the slate first loads; saves the
 *                                   expected starter for each game to AsyncStorage
 *   checkForPitcherScratches()    → re-fetches today's probable pitchers from the
 *                                   MLB API and compares to what was stored;
 *                                   returns an array of scratches for notification
 *
 * Background interval: every ~15 min (3rd background-fetch wake at 5 min base)
 * Foreground interval: every 5 min
 *
 * Storage key: 'statfax_starting_pitchers' → { [gamePk]: { id, name } }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE_KEY = 'statfax_starting_pitchers';
const MLB_BASE  = 'https://statsapi.mlb.com/api/v1';

/**
 * Persist the starting pitchers from the freshly fetched slate.
 * games: array of scored game objects that include gamePk + pitcher info
 */
export async function storePitchers(games = []) {
  const map = {};
  for (const g of games) {
    const gamePk = String(g.gamePk);
    // Pitcher data is attached during scoring — use awayPitcher / homePitcher
    if (g.awayPitcher?.id)  map[`${gamePk}-away`] = { id: g.awayPitcher.id,  name: g.awayPitcher.name  || 'TBD' };
    if (g.homePitcher?.id)  map[`${gamePk}-home`] = { id: g.homePitcher.id,  name: g.homePitcher.name  || 'TBD' };
  }
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(map)).catch(() => {});
}

/**
 * Fetch current probable pitchers from the MLB API and compare to stored.
 * Returns an array of scratch objects:
 *   [{ awayAbbr, homeAbbr, oldPitcher, newPitcher }]
 */
export async function checkForPitcherScratches() {
  // Local YYYY-MM-DD; UTC was returning tomorrow for west-coast users in
  // the evening and the schedule fetch missed tonight's starters entirely.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Load stored pitchers
  let stored;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    stored = raw ? JSON.parse(raw) : {};
  } catch {
    return [];
  }
  if (!Object.keys(stored).length) return [];

  // Fetch today's schedule with probable pitchers
  let schedData;
  try {
    const res = await fetch(
      `${MLB_BASE}/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team`
    );
    if (!res.ok) return [];
    schedData = await res.json();
  } catch {
    return [];
  }

  const scratches = [];
  const updatedMap = { ...stored };

  for (const dateEntry of schedData.dates || []) {
    for (const g of dateEntry.games || []) {
      const gamePk   = String(g.gamePk);
      const awayAbbr = g.teams?.away?.team?.abbreviation || '???';
      const homeAbbr = g.teams?.home?.team?.abbreviation || '???';

      const sides = [
        { side: 'away', pitcher: g.teams?.away?.probablePitcher },
        { side: 'home', pitcher: g.teams?.home?.probablePitcher },
      ];

      for (const { side, pitcher } of sides) {
        if (!pitcher?.id) continue;
        const key      = `${gamePk}-${side}`;
        const previous = stored[key];
        if (!previous) continue; // wasn't stored — no baseline to compare

        if (previous.id !== pitcher.id) {
          scratches.push({
            gamePk,  // needed so the notification gets a stable identifier
            awayAbbr,
            homeAbbr,
            oldPitcher: previous.name,
            newPitcher: pitcher.fullName || pitcher.lastName || 'Unknown',
          });
          // Update stored value so we don't re-notify
          updatedMap[key] = { id: pitcher.id, name: pitcher.fullName || pitcher.lastName || 'Unknown' };
        }
      }
    }
  }

  if (scratches.length > 0) {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(updatedMap)).catch(() => {});
  }

  return scratches;
}
