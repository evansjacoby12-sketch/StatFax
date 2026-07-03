// Tiny haptic helper — a short tick on tactile actions (watch, parlay leg,
// swipe). navigator.vibrate is Android/Chrome only; everywhere else this is a
// silent no-op, so callers never need to feature-check.
export function buzz(ms = 10) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* unsupported / blocked — ignore */
  }
}
