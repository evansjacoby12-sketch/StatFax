/**
 * hrPoller — background HR detection for HRSauce
 *
 * Uses expo-background-fetch + expo-task-manager to check live MLB games
 * for new home runs every ~5 minutes (iOS may stretch the interval; the OS
 * controls actual timing for battery reasons). Also exports checkForNewHRs
 * so the foreground interval in App.js can use the same logic.
 *
 * IMPORTANT: TaskManager.defineTask must be called at module level (not inside
 * a component or function) before the React tree mounts. Import this file as a
 * side effect near the top of App.js:
 *   import './src/utils/hrPoller';
 */

import * as TaskManager    from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage        from '@react-native-async-storage/async-storage';
import { triggerHRNotification, triggerLineupNotification, triggerPitcherScratchNotification } from './notifications';
import { checkForNewLineups } from './lineupPoller';
import { checkForPitcherScratches } from './pitcherWatcher';

const POLL_COUNT_KEY = 'statfax_bg_poll_count';

const TASK_NAME = 'HRSAUCE_HR_POLL';
const SEEN_KEY  = 'hrsauce_seen_hrs';
const MLB_BASE  = 'https://statsapi.mlb.com/api/v1';

// ─── Generic notification messages ───────────────────────────────────────────

const HR_SINGLES = [
  n => `🏠 ${n} just went yard — check the Live tab!`,
  n => `💥 ${n} hit one out — StatFax has it live.`,
  n => `⚾ Home run! ${n} goes deep.`,
  n => `🚀 ${n} launched one. Check the Live tab.`,
];

const HR_MULTIS = [
  ct => `💥 ${ct} home runs just hit across today's games!`,
  ct => `🏠 ${ct} homers — things are heating up. Check the Live tab.`,
  ct => `⚾ ${ct} shots just left the yard. Live tab has the details.`,
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Core HR check ───────────────────────────────────────────────────────────

/**
 * Fetch all live MLB games and return an array of HR events that haven't been
 * seen before. Updates the seen set in AsyncStorage.
 *
 * Each returned item: { key, batter, gamePk, inning, awayAbbr, homeAbbr }
 */
export async function checkForNewHRs() {
  // Local YYYY-MM-DD, not UTC. The old `toISOString().split('T')[0]` would
  // return tomorrow's UTC date for west-coast users opening the app after
  // ~5pm local — so the schedule fetch hit a slate that didn't exist yet.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 1. Get today's schedule — only care about Live games
  const schedRes = await fetch(
    `${MLB_BASE}/schedule?sportId=1&date=${today}&hydrate=linescore,team`
  );
  if (!schedRes.ok) return [];
  const schedData = await schedRes.json();

  const liveGames = [];
  for (const dateEntry of schedData.dates || []) {
    for (const g of dateEntry.games || []) {
      if (g.status?.abstractGameState === 'Live') {
        liveGames.push({
          gamePk:    g.gamePk,
          awayAbbr:  g.teams?.away?.team?.abbreviation || '',
          homeAbbr:  g.teams?.home?.team?.abbreviation || '',
        });
      }
    }
  }

  if (!liveGames.length) return [];   // no games in progress → nothing to fire

  // 2. Load already-notified HR keys
  let seen;
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    seen = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    seen = new Set();
  }

  // 3. For each live game, pull the live feed and look for HR plays
  const newHRs = [];

  await Promise.all(
    liveGames.map(async ({ gamePk, awayAbbr, homeAbbr }) => {
      try {
        const feedRes = await fetch(`${MLB_BASE}/game/${gamePk}/feed/live`);
        if (!feedRes.ok) return;
        const feed  = await feedRes.json();
        const plays = feed.liveData?.plays?.allPlays || [];

        for (const play of plays) {
          if (play.result?.eventType !== 'home_run') continue;

          // atBatIndex is a monotonically increasing counter — unique per game
          const key = `${gamePk}-${play.about?.atBatIndex ?? play.about?.inning}`;
          if (seen.has(key)) continue;

          seen.add(key);
          newHRs.push({
            key,
            batter:   play.matchup?.batter?.fullName || 'A batter',
            gamePk,
            inning:   play.about?.inning ?? null,
            awayAbbr,
            homeAbbr,
            distance: play.hitData?.totalDistance ? Math.round(play.hitData.totalDistance) : null,
          });
        }
      } catch {
        // Silently skip — network blip or game feed not yet available
      }
    })
  );

  // 4. Persist the updated seen set so we never double-notify
  if (newHRs.length > 0) {
    // Trim to last 500 keys to avoid unbounded growth over a long season
    const trimmed = [...seen].slice(-500);
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(trimmed)).catch(() => {});
    // Notification firing is the CALLER's responsibility — the background
    // TaskManager hook below already calls triggerHRNotification(). Firing
    // it here too caused every detected HR to push the notification twice.
  }

  return newHRs;
}

/**
 * Clear the seen-HRs set — call at the start of each new day so yesterday's
 * HRs don't pollute today's tracking.
 */
export async function clearSeenHRs() {
  await AsyncStorage.removeItem(SEEN_KEY).catch(() => {});
}

// ─── Background task (runs when app is backgrounded / closed) ────────────────

// defineTask MUST be at module level — this fires when the OS wakes the app.
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const prefs = await AsyncStorage.multiGet([
      'statfax_hr_notifs',
      'statfax_lineup_notifs',
      POLL_COUNT_KEY,
    ]).catch(() => []);
    const prefMap = Object.fromEntries((prefs || []).map(([k, v]) => [k, v]));
    const hrEnabled      = prefMap['statfax_hr_notifs']     !== 'false';
    const lineupEnabled  = prefMap['statfax_lineup_notifs'] !== 'false';

    // Increment poll counter — used to throttle less-frequent checks
    const pollCount = (parseInt(prefMap[POLL_COUNT_KEY] || '0', 10) + 1) % 100;
    await AsyncStorage.setItem(POLL_COUNT_KEY, String(pollCount)).catch(() => {});
    const runPitcherCheck = pollCount % 3 === 0; // every 3rd wake (~15 min)

    const [newHRs, newLineups, newScratches] = await Promise.all([
      hrEnabled     ? checkForNewHRs()           : [],
      lineupEnabled ? checkForNewLineups()        : [],
      runPitcherCheck ? checkForPitcherScratches() : [],
    ]);

    if (hrEnabled     && newHRs.length)      await triggerHRNotification(newHRs);
    if (lineupEnabled && newLineups.length)  await triggerLineupNotification(newLineups);
    if (newScratches.length)                 await triggerPitcherScratchNotification(newScratches);

    return (newHRs.length + newLineups.length + newScratches.length) > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register the background HR poll task.
 * minimumInterval = 5 min; iOS will honor this loosely (OS decides exact timing).
 */
export async function registerHRBackgroundFetch() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    // Don't try to register if background fetch is restricted / denied on this device
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(TASK_NAME, {
        minimumInterval: 5 * 60,   // 5 minutes (iOS may run less often)
        stopOnTerminate:  false,    // keep running after app is killed
        startOnBoot:      true,     // Android: re-register after device restart
      });
    }
  } catch {
    // Background fetch not available in Expo Go — only works in development builds
  }
}

export async function unregisterHRBackgroundFetch() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
    }
  } catch {}
}
