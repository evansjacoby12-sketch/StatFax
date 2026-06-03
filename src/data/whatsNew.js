/**
 * whatsNew.js
 * ───────────
 * Static registry of "What's New" features surfaced after an OTA lands.
 *
 * Design: we use WHATS_NEW_VERSION as the trigger key rather than
 * Updates.updateId directly. This gives us full control — bumping the
 * version string forces the sheet to re-appear on the user's next launch
 * regardless of whether the OTA group ID changed. Useful for re-surfacing
 * a release if messaging needs tweaking, or for skipping the sheet on
 * hot-fix OTAs that don't contain user-visible changes.
 */

export const WHATS_NEW_VERSION = '2026-05-26-v2';
export const WHATS_NEW_TITLE   = "What's new";

export const WHATS_NEW_FEATURES = [
  {
    emoji: '🎯',
    title: 'Top pick of the day',
    body:  `Pinned at the top of Today — the model's #1 take with one-tap lock to parlay.`,
  },
  {
    emoji: '✨',
    title: 'Best 2-Man recommender',
    body:  `New "2 MAN" button on StatMatch surfaces the highest-EV pair from tonight's slate, grouped by angle (Structural / Matchup / Environment / Market / Momentum).`,
  },
  {
    emoji: '🎨',
    title: 'Filter chips on Today',
    body:  'Pill row: HOT / ZONE MASTER / +EDGE / NUKE PARK. Multi-select, OR semantics.',
  },
  {
    emoji: '📊',
    title: 'Calibration transparency',
    body:  `Small badge shows our PRIME picks' rolling 7-day hit rate vs league baseline.`,
  },
  {
    emoji: '⚡',
    title: 'Pull-to-refresh now triggers a fresh slate',
    body:  'Yanking down on Today pokes our cron worker so the snapshot actually refreshes.',
  },
  {
    emoji: '💆',
    title: 'Haptic feedback',
    body:  'Subtle taps confirm refresh, parlay locks, filter chips, and more.',
  },
  {
    emoji: '🧭',
    title: 'Wind compass redesign',
    body:  `Stadium silhouette under the needle so wind reads as "toward LF" not raw bearing.`,
  },
  {
    emoji: '🏟️',
    title: 'Parlay templates',
    body:  'Empty-state cards: Nuke Park Stack / Zone Master Trio / Prime Only / Hot Bats. One tap pre-fills the slip.',
  },
  {
    emoji: '👆',
    title: 'Long-press a player row',
    body:  'Opens a quick menu: add to parlay / watchlist / view details.',
  },
];
