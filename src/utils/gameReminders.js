/**
 * gameReminders — schedules time-based local notifications for upcoming games.
 *
 * Two types:
 *   1. Pre-game reminder — fires 1 hr before first pitch for every game
 *   2. Parlay reminder   — fires 30 min before first pitch for games where
 *                          the user has saved parlay picks
 *
 * Both are scheduled as time-trigger notifications (no polling needed) whenever
 * the slate is fetched. Old reminders are cancelled first to avoid duplicates.
 *
 * Notification IDs are keyed by gamePk so they can be individually cancelled.
 */

import * as Notifications from 'expo-notifications';
import { lastName as displayLastName } from './playerName';

const PRE_GAME_PREFIX = 'statfax-pregame-';
const PARLAY_PREFIX   = 'statfax-parlay-';

/**
 * Schedule pre-game and parlay reminders for today's games.
 *
 * @param {Array}  games       — scored game objects from runFetch (need gamePk, gameDate, awayTeam, homeTeam)
 * @param {Array}  parlayPicks — current parlay picks from context [{ gamePk, name }]
 */
export async function scheduleGameReminders(games = [], parlayPicks = []) {
  // Cancel all previous reminders first
  await cancelGameReminders();

  const now = Date.now();
  const parlayGamePks = new Set(parlayPicks.map(p => String(p.gamePk)));

  for (const game of games) {
    const gameTime = new Date(game.gameDate).getTime();
    if (!gameTime || isNaN(gameTime)) continue;

    // BUGFIX: game.awayTeam / game.homeTeam are OBJECTS ({ id, abbr, name }),
    // not strings. Earlier code interpolated them directly into the notification
    // template string which rendered "[Object Object] @ [Object Object]".
    // Pull the abbreviation (or full name) for the display string.
    const away = game.awayTeam?.abbr || game.awayTeam?.name || game.away || '???';
    const home = game.homeTeam?.abbr || game.homeTeam?.name || game.home || '???';

    // ── Pre-game reminder: 1 hour before first pitch ──────────────────────
    const preGameFireAt = gameTime - 60 * 60 * 1000; // 1 hr before
    if (preGameFireAt > now + 30_000) { // only schedule if it's still in the future
      await Notifications.scheduleNotificationAsync({
        identifier: `${PRE_GAME_PREFIX}${game.gamePk}`,
        content: {
          title: '🎯 Game starts in 1 hour',
          body:  `${away} @ ${home} — check your top picks and lock them in`,
          sound: true,
          data:  { type: 'pregame_reminder', gamePk: game.gamePk },
        },
        trigger: { type: 'date', date: new Date(preGameFireAt) },
      }).catch(() => {}); // silently skip if scheduling fails
    }

    // ── Parlay reminder: 30 min before first pitch (only games with picks) ─
    if (parlayGamePks.has(String(game.gamePk))) {
      const parlayFireAt = gameTime - 30 * 60 * 1000; // 30 min before
      if (parlayFireAt > now + 30_000) {
        const gamePicks  = parlayPicks.filter(p => String(p.gamePk) === String(game.gamePk));
        // Show first two names + "+N more" overflow. The previous version
        // joined the FULL list and then appended the overflow suffix, so a
        // 5-pick game read "A, B, C, D, E +3 more".
        const pickNames  = gamePicks.slice(0, 2).map(p => displayLastName(p.name || '')).join(', ');
        const extra      = gamePicks.length > 2 ? ` +${gamePicks.length - 2} more` : '';

        await Notifications.scheduleNotificationAsync({
          identifier: `${PARLAY_PREFIX}${game.gamePk}`,
          content: {
            title: `⚡ ${away} @ ${home} starts in 30 min`,
            body:  `Your picks: ${pickNames}${extra} — time to place your bets`,
            sound: true,
            data:  { type: 'parlay_reminder', gamePk: game.gamePk },
          },
          trigger: { type: 'date', date: new Date(parlayFireAt) },
        }).catch(() => {});
      }
    }
  }
}

/** Cancel all scheduled pre-game and parlay reminders. */
export async function cancelGameReminders() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const toCancel  = scheduled
      .filter(n => n.identifier?.startsWith(PRE_GAME_PREFIX) || n.identifier?.startsWith(PARLAY_PREFIX))
      .map(n => n.identifier);
    await Promise.all(toCancel.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  } catch {}
}
