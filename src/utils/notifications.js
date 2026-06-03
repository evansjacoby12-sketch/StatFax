import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// How the notification looks when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

// ─── Generic message pool ─────────────────────────────────────────────────────

const DAILY_MESSAGES = [
  { title: '⚾ MLB Slate Is Live', body: "Today's HR picks are ready — who's going deep?" },
  { title: '💎 Top Picks Waiting', body: 'Your daily HR rankings just dropped. Check the slate.' },
  { title: '⚾ Time to Check the Slate', body: 'New HR probability data is available for today.' },
  { title: '🏟️ Baseball Is Back Today', body: 'Load your slate and lock in your top HR plays.' },
  { title: '💥 Who Goes Deep Today?', body: "Fire up StatFax — today's picks are ready." },
  { title: '⚾ Daily HR Rankings Ready', body: 'Check who the sauce is riding today.' },
  { title: '🎯 Slate Time', body: "Open StatFax and see today's top HR probabilities." },
];

const FETCH_MESSAGES = [
  { title: '💎 Slate Loaded', body: "Your top HR picks for today are ready. Let's ride." },
  { title: '⚾ Picks Are In', body: "Today's HR slate is scored and sorted. Check the board." },
  { title: '🔥 HR Slate Ready', body: 'Rankings are live — see who the sauce likes today.' },
  { title: '💥 Data Is Fresh', body: "Today's MLB probabilities are loaded and ready." },
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Permission request ───────────────────────────────────────────────────────

/**
 * Ask for notification permissions. Returns true if granted.
 * Safe to call multiple times — won't re-prompt if already granted.
 */
export async function requestNotificationPermissions() {
  if (!Device.isDevice) {
    // Simulators can't receive push notifications
    return false;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'StatFax',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00D4FF',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ─── Daily reminder ───────────────────────────────────────────────────────────

const DAILY_REMINDER_ID = 'hrsauce-daily-reminder';

/**
 * Schedule a daily notification at the given hour/minute (24h, local time).
 * Replaces any existing daily reminder.
 */
export async function scheduleDailyReminder(hour = 10, minute = 30) {
  // Cancel old one first so we don't stack duplicates
  await cancelDailyReminder();

  const msg = randomFrom(DAILY_MESSAGES);

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER_ID,
    content: {
      title: msg.title,
      body:  msg.body,
      sound: true,
      data:  { type: 'daily' },
    },
    trigger: {
      type: 'calendar',
      repeats: true,
      hour,
      minute,
    },
  });
}

export async function cancelDailyReminder() {
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID).catch(() => {});
}

// ─── Post-fetch notification (fires immediately) ──────────────────────────────

/**
 * Fire a one-shot notification right now (useful when app goes to background
 * while the fetch is running, or just as an in-notification confirmation).
 * Pass topTierCount so the body can mention it if you like (optional).
 */
export async function triggerSlateLoadedNotification(topTierCount = 0) {
  const msg = randomFrom(FETCH_MESSAGES);

  const body = topTierCount > 0
    ? `${topTierCount} 💎 TOP TIER pick${topTierCount !== 1 ? 's' : ''} today — ${msg.body}`
    : msg.body;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: msg.title,
      body,
      sound: true,
      data:  { type: 'fetch' },
    },
    trigger: null, // fires immediately
  });
}

// ─── HR alert notification ────────────────────────────────────────────────────

function shortName(fullName) {
  const parts = (fullName || 'A batter').split(' ');
  return parts.length >= 2
    ? `${parts[0][0]}. ${parts.slice(1).join(' ')}`
    : fullName;
}

/**
 * Fire a single grouped notification for all newly detected HR events.
 * newHRs: Array of { batter, gamePk, inning, awayAbbr, homeAbbr, distance }
 */
export async function triggerHRNotification(newHRs = []) {
  if (!newHRs.length) return;

  const count = newHRs.length;

  let title, body;

  if (count === 1) {
    const hr   = newHRs[0];
    const name = shortName(hr.batter);
    const dist = hr.distance ? ` - ${hr.distance} feet!` : '!';
    title = `${name} went Yard${dist} ⚾`;
    body  = hr.inning ? `Inning ${hr.inning} — check the Live tab` : 'Check the Live tab';
  } else {
    // Multiple HRs — show first 2 names + overflow count
    title = 'Come Look 👀';
    const first2 = newHRs.slice(0, 2).map(h => shortName(h.batter).split('. ')[1] || shortName(h.batter));
    const extra  = count > 2 ? ` and ${count - 2} other${count - 2 > 1 ? 's' : ''}` : '';
    body = `${first2.join(', ')}${extra} scored HRs!`;
  }

  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, data: { type: 'hr_alert', count } },
    trigger: null,
  });
}

// ─── Lineup notification ──────────────────────────────────────────────────────

/**
 * AsyncStorage key holding the timestamp (ms) of the last lineup change
 * the background poller detected. HomeScreen.runFetch reads this and uses
 * it to (a) force a snapshot cache bust and (b) re-check MLB live for any
 * games whose lineups aren't fully confirmed in the snapshot.
 *
 * Why this matters: the background poller hits the MLB API directly so
 * pushes fire the moment lineups drop (~ within ~5 min). The R2 snapshot
 * only regenerates every 10 min — and slower when GitHub Actions throttles
 * private-repo cron schedules. Without this flag the user would tap the
 * push, open the app, and still see "PROJECTED" until the next cron run.
 */
export const LINEUP_CHANGED_AT_KEY = 'statfax_lineup_changed_at';

/**
 * Fire a single grouped notification for all newly confirmed lineups.
 * newLineups: Array of { awayAbbr, homeAbbr, side } where side = 'away' | 'home'
 *
 * Also stamps LINEUP_CHANGED_AT_KEY with `Date.now()` so the next slate
 * fetch knows to re-check MLB lineups for any non-confirmed sides — see
 * the key doc above for why this is necessary.
 */
export async function triggerLineupNotification(newLineups = []) {
  if (!newLineups.length) return;

  // Stamp the change time BEFORE firing the push so even if the push
  // delivery is delayed by APNs, the flag is in place by the time the
  // user opens the app.
  AsyncStorage.setItem(LINEUP_CHANGED_AT_KEY, String(Date.now())).catch(() => {});

  const count = newLineups.length;
  const title = 'Lineup Update 👥';
  let body;

  if (count === 1) {
    const lu      = newLineups[0];
    const team    = lu.side === 'away' ? lu.awayAbbr : lu.homeAbbr;
    body = `${lu.awayAbbr} @ ${lu.homeAbbr}: ${team} Lineup Updated`;
  } else {
    // Multiple lineups — list first 2 teams + overflow
    const teams = newLineups.slice(0, 2).map(lu => lu.side === 'away' ? lu.awayAbbr : lu.homeAbbr);
    const extra = count > 2 ? ` and ${count - 2} more` : '';
    body = `${teams.join(', ')}${extra} Lineups Updated`;
  }

  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, data: { type: 'lineup', count } },
    trigger: null,
  });
}

// ─── ELITE pick confirmed ─────────────────────────────────────────────────────

/**
 * Fire when a saved parlay pick's lineup is officially confirmed.
 * picks: Array of { name, team, battingOrder }
 */
export async function triggerElitePickConfirmedNotification(picks = []) {
  if (!picks.length) return;

  const names = picks.slice(0, 2).map(p => shortName(p.name));
  const extra = picks.length > 2 ? ` +${picks.length - 2} more` : '';
  const orderStr = picks.length === 1 && picks[0].battingOrder
    ? ` batting ${picks[0].battingOrder}`
    : '';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `💎 Pick Confirmed${orderStr}`,
      body:  `${names.join(' & ')}${extra} — lineup is official`,
      sound: true,
      data:  { type: 'elite_confirmed' },
    },
    trigger: null,
  });
}

// ─── Parlay reminder ──────────────────────────────────────────────────────────

/**
 * Fire a reminder when games with parlay picks are about to start.
 * picks: Array of pick names
 * minutesUntil: how many minutes until first pitch
 */
export async function triggerParlayReminderNotification(pickNames = [], minutesUntil = 30) {
  if (!pickNames.length) return;

  const names  = pickNames.slice(0, 2).join(', ');
  const extra  = pickNames.length > 2 ? ` +${pickNames.length - 2} more` : '';
  const timing = minutesUntil <= 30 ? '30 minutes' : '1 hour';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `⚡ Games start in ${timing}`,
      body:  `Your picks: ${names}${extra} — lock them in`,
      sound: true,
      data:  { type: 'parlay_reminder' },
    },
    trigger: null,
  });
}

// ─── Pitcher scratch ──────────────────────────────────────────────────────────

/**
 * Fire when a starting pitcher is replaced.
 * scratches: Array of { awayAbbr, homeAbbr, oldPitcher, newPitcher }
 */
export async function triggerPitcherScratchNotification(scratches = []) {
  if (!scratches.length) return;

  for (const s of scratches) {
    await Notifications.scheduleNotificationAsync({
      // Stable identifier so the same scratch can't fire twice (e.g. if the
      // watcher's stored state ever gets wiped and re-detects the change).
      identifier: `statfax-pitcher-scratch-${s.gamePk || `${s.awayAbbr}-${s.homeAbbr}`}-${(s.newPitcher || '').replace(/\s+/g, '')}`,
      content: {
        title: `🚨 Pitcher Change — ${s.awayAbbr} @ ${s.homeAbbr}`,
        body:  `${s.oldPitcher} scratched → ${s.newPitcher} now starting`,
        sound: true,
        data:  { type: 'pitcher_scratch' },
      },
      trigger: null,
    }).catch(() => {});  // .catch swallows "identifier already used" — desired dedupe
  }
}

// ─── Weather change ───────────────────────────────────────────────────────────

/**
 * Fire when env conditions shift significantly at a ballpark.
 * changes: Array of { awayAbbr, homeAbbr, delta, direction }
 * direction: 'better' | 'worse'
 */
export async function triggerWeatherChangeNotification(changes = []) {
  if (!changes.length) return;

  const today = new Date().toISOString().slice(0, 10);
  for (const c of changes) {
    const arrow = c.direction === 'better' ? '📈' : '📉';
    await Notifications.scheduleNotificationAsync({
      // Stable identifier — per game, per day, per direction. Re-firing a
      // duplicate weather shift later in the day gets silently deduped.
      identifier: `statfax-weather-${c.gamePk || `${c.awayAbbr}-${c.homeAbbr}`}-${today}-${c.direction}`,
      content: {
        title: `${arrow} Weather Shift — ${c.awayAbbr} @ ${c.homeAbbr}`,
        body:  `HR conditions ${c.direction === 'better' ? 'improved' : 'worsened'} — check updated scores`,
        sound: true,
        data:  { type: 'weather_change' },
      },
      trigger: null,
    }).catch(() => {});
  }
}

// ─── Daily slate notification ─────────────────────────────────────────────────

const DAILY_SLATE_ID = 'statfax-daily-slate';

/**
 * Schedule a daily notification at the given hour/minute (24h, local time).
 * Replaces any existing daily slate reminder.
 *
 * Also defensively cancels the legacy `hrsauce-daily-reminder` identifier —
 * users who upgraded through the HRSauce→StatFax rename were getting BOTH
 * reminders firing because the old scheduled notification was still in the
 * OS queue under the legacy ID and nothing here ever removed it.
 */
export async function scheduleDailySlateNotification(hour = 10, minute = 30) {
  await Notifications.cancelScheduledNotificationAsync(DAILY_SLATE_ID).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_SLATE_ID,
    content: {
      title: '⚾ Today\'s Slate Is Ready',
      body:  'Open StatFax and see who the sauce likes today',
      sound: true,
      data:  { type: 'daily_slate' },
    },
    trigger: { type: 'calendar', repeats: true, hour, minute },
  });
}

export async function cancelDailySlateNotification() {
  await Notifications.cancelScheduledNotificationAsync(DAILY_SLATE_ID).catch(() => {});
}

// ─── Cancel everything ────────────────────────────────────────────────────────

export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
}
