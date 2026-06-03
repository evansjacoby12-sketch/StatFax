/**
 * playerName — helpers for displaying baseball player names.
 *
 * The simple `name.split(' ').slice(-1)[0]` trick breaks for players whose
 * names end in a generational suffix:
 *
 *   "Michael Harris II"      → wants "Harris II", not "II"
 *   "Bobby Witt Jr."         → wants "Witt Jr.", not "Jr."
 *   "Vladimir Guerrero Jr."  → wants "Guerrero Jr."
 *   "Cal Ripken Sr."         → wants "Ripken Sr."
 *
 * `lastName(name)` returns the family-name token, plus the suffix if present.
 */

const SUFFIXES = new Set([
  'jr', 'jr.', 'sr', 'sr.',
  'ii', 'iii', 'iv', 'v',
]);

function isSuffix(token) {
  return SUFFIXES.has((token || '').toLowerCase().replace(/[.,]$/, '') )
      || SUFFIXES.has((token || '').toLowerCase());
}

/**
 * Get the display "last name" for a player. Includes the generational suffix
 * when present so display lists don't collapse "Bobby Witt Jr." down to just
 * "Jr.".
 */
export function lastName(fullName) {
  if (!fullName || typeof fullName !== 'string') return fullName || '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;

  const last = parts[parts.length - 1];
  if (isSuffix(last) && parts.length >= 2) {
    return `${parts[parts.length - 2]} ${last}`;
  }
  return last;
}
