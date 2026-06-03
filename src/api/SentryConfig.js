/**
 * SentryConfig — error tracking for production.
 *
 * Sign up at https://sentry.io (free tier covers ~5k events/month — plenty
 * for early-stage apps). Create a "React Native" project, copy its DSN
 * from Project Settings → Client Keys (DSN), and paste it below.
 *
 * Until a DSN is set, all Sentry calls short-circuit to a no-op. So we
 * can ship this code today and turn tracking on later by just pasting
 * the DSN + pushing — no app changes needed.
 *
 * What Sentry gives us:
 *   - Automatic JS crash + unhandled promise rejection capture
 *   - Native crash capture (iOS NSException, Android Java/Kotlin)
 *   - Stack traces de-obfuscated against the EAS Update sourcemap
 *   - Breadcrumb trails leading up to a crash (navigation, network, console)
 *   - Performance / slow transaction monitoring (opt-in via tracesSampleRate)
 *
 * Privacy: Sentry by default collects device model, OS version, network
 * type, app version, and the stack trace. NO user-entered data unless
 * we explicitly attach it via Sentry.setUser() or breadcrumbs.
 */

import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import * as Sentry from '@sentry/react-native';

// @sentry/react-native is built primarily for native runtimes. When the
// Metro web bundler pulls it in, the TouchEventBoundary used by
// `Sentry.wrap()` calls `findNodeHandle` on every gesture, which can
// throw on react-native-web because RN-Web nodes aren't real native
// views. Result on web: the App tree mounts fine, but the FIRST gesture
// (e.g. a tab tap) crashes the navigator. We skip Sentry entirely on
// web and rely on the browser's built-in error reporting + DevTools
// instead. Native (iOS/Android) keeps full Sentry coverage.
const SENTRY_DISABLED_ON_THIS_PLATFORM = Platform.OS === 'web';

// Active Sentry DSN — points at the statfax project on sentry.io.
// Safe to embed in client bundles: the DSN authorizes the project to
// RECEIVE events, but each event still needs to come from the actual app
// (no admin powers attached to this string).
const SENTRY_DSN = 'https://34f98a68b2d34544761bd07ebddff064@o4511434460102656.ingest.us.sentry.io/4511434485465088';

let _initialized = false;

/**
 * Initialize Sentry. Safe to call multiple times (idempotent) and a no-op
 * when SENTRY_DSN is empty. Call this once at the very top of App.js, before
 * any other module-level code that might throw.
 */
export function initSentry() {
  if (_initialized || !SENTRY_DSN) return;
  if (SENTRY_DISABLED_ON_THIS_PLATFORM) return;
  try {
    // Release + dist identify which build a crash came from, so Sentry
    // can group reports by version AND match them against the right
    // uploaded source map.
    //
    //   release = "com.statfax.app@<runtimeVersion>"
    //             stable across OTA updates within the same binary;
    //             changes only when you ship a new EAS Build (since
    //             runtimeVersion policy is "appVersion" in app.json).
    //   dist    = updateId (or 'binary' for the baked-in JS bundle)
    //             changes on every OTA update so we can pinpoint which
    //             specific JS payload was running when a crash happened.
    //
    // Together these give Sentry's UI two-dimensional grouping:
    //   "1.0.6 → update-019e5c42-..." → "stack-trace X"
    //   "1.0.6 → update-019e5c44-..." → "stack-trace Y"
    // so you can see exactly which OTA introduced a regression.
    const runtimeVersion = Updates.runtimeVersion || '0.0.0';
    const release = `com.statfax.app@${runtimeVersion}`;
    const dist    = Updates.updateId || 'binary';

    Sentry.init({
      dsn:                     SENTRY_DSN,
      environment:             __DEV__ ? 'development' : 'production',
      release,
      dist,
      // Sample 20% of transactions for performance monitoring. Errors are
      // captured at 100% — this only throttles slow-transaction reports.
      tracesSampleRate:        0.2,
      enableAutoSessionTracking: true,
      enableNativeCrashHandling: true,
      // Don't send PII (email, IP) automatically. We attach user.id via
      // setUser() when someone signs in via Supabase — controlled by us,
      // not by the SDK's default heuristics.
      sendDefaultPii:          false,
      // Skip noisy dev errors that would burn through the free-tier quota.
      // Production crashes still report.
      enabled:                 !__DEV__,
    });
    // Set as a top-level tag too so non-event surfaces (transactions,
    // session replays) carry the tag. Sentry's release filtering reads
    // event.release; this tag is extra signal for dashboards / alerts.
    Sentry.setTag('ota.update_id', dist);
    Sentry.setTag('runtime_version', runtimeVersion);
    _initialized = true;
  } catch {
    // If Sentry init itself throws (rare — malformed DSN, etc.), swallow
    // it. Better to lose tracking than to crash boot.
  }
}

/**
 * Wrap the root App component so Sentry's ErrorBoundary catches render-time
 * errors anywhere in the tree. When DSN is empty, returns the component
 * unchanged.
 */
export function wrapApp(AppComponent) {
  if (!SENTRY_DSN) return AppComponent;
  if (SENTRY_DISABLED_ON_THIS_PLATFORM) return AppComponent;
  return Sentry.wrap(AppComponent);
}

/**
 * Tag the current user on every event going forward. Call this from the
 * AppContext auth state listener when SIGNED_IN fires, and clear it on
 * SIGNED_OUT. Helps correlate a crash report to a specific account.
 */
export function setSentryUser(user) {
  if (!_initialized) return;
  try {
    if (user?.id) {
      Sentry.setUser({ id: user.id, email: user.email });
    } else {
      Sentry.setUser(null);
    }
  } catch {}
}

/**
 * Manually report a non-fatal error (e.g., a fetch that failed gracefully).
 * No-op when Sentry isn't initialized.
 */
export function reportError(err, context) {
  if (!_initialized) return;
  try {
    if (context) Sentry.setContext('extra', context);
    Sentry.captureException(err);
  } catch {}
}

export { Sentry };

/* ── Source maps — next step (one-time setup, needs an EAS Build) ──────────
 *
 * Release tagging (above) is fully OTA-shippable. Source maps are NOT —
 * they need to be uploaded at build/update time so Sentry can de-obfuscate
 * the minified stack traces in crash reports.
 *
 * Setup steps:
 *
 *  1. Generate a Sentry auth token:
 *     sentry.io → Account → API → Auth Tokens → Create New Token
 *     Scopes needed: project:releases, org:read
 *
 *  2. Add to EAS secrets so builds + `eas update` can use it:
 *       eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>
 *
 *  3. Add the @sentry/react-native plugin to app.json so the EAS build
 *     hooks know to upload source maps. The plugin auto-detects org/project
 *     from the DSN; no other config needed:
 *       "plugins": [
 *         "expo-web-browser",
 *         "expo-notifications",
 *         ["@sentry/react-native/expo", {
 *           "organization": "<your-sentry-org-slug>",
 *           "project": "statfax"
 *         }]
 *       ]
 *
 *  4. Ship a new EAS Build (one-time per binary). Subsequent OTA updates
 *     will auto-upload source maps as part of `eas update`.
 *
 * Until step 4 lands, crashes still report with release + dist tags
 * (above) — you can still group them by OTA — but the stack frames will
 * stay minified (`a.b(c)` instead of `HomeScreen.handleFetch (HomeScreen.js:1234)`).
 */
