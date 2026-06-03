/**
 * @fileoverview Haptics feedback utility module for StatFax.
 *
 * This module wraps expo-haptics calls in try/catch blocks to ensure haptic
 * feedback never crashes the app. Haptics are treated as pure UX enhancements
 * ("sprinkles") — never load-bearing functionality. Failures are silent by design:
 * web platform has no haptic support, older devices may not implement all feedback
 * types, and network conditions can delay the module import. All functions return
 * Promises but are designed to be fire-and-forget; callers should NOT await them.
 * This architecture gracefully degrades on unsupported platforms without breaking
 * the user experience.
 */

import * as Haptics from 'expo-haptics';

/**
 * Soft tap feedback for lightweight interactions.
 *
 * Triggers a light, brief haptic pulse suitable for low-priority user actions:
 * chip/filter selection, toggling options, swiping through cards in the deck.
 * Uses Haptics.selectionAsync() which typically produces a gentle "tick" sensation.
 * Never awaited by callers (fire-and-forget).
 *
 * @returns {Promise<void>} Promise that resolves when complete or silently fails
 *   on unsupported platforms/devices.
 */
export async function softTap() {
  try {
    await Haptics.selectionAsync();
  } catch (error) {
    // Silently fail on web, older devices, or if module not ready
  }
}

/**
 * Medium tap feedback for moderate-impact actions.
 *
 * Triggers a medium-strength haptic impact suitable for actions with
 * user-visible consequences: adding a parlay leg, completing a refresh,
 * opening a modal. Uses Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
 * which delivers a more pronounced "thud" than softTap. Never awaited by callers
 * (fire-and-forget).
 *
 * @returns {Promise<void>} Promise that resolves when complete or silently fails
 *   on unsupported platforms/devices.
 */
export async function mediumTap() {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch (error) {
    // Silently fail on web, older devices, or if module not ready
  }
}

/**
 * Success notification feedback for positive user outcomes.
 *
 * Triggers a success-pattern haptic sequence (typically rapid double-tap or
 * "chirp" sensation) suitable for confirming favorable actions: parlay saved,
 * match made, OTA update applied. Uses Haptics.notificationAsync() with
 * Success feedback type. Never awaited by callers (fire-and-forget).
 *
 * @returns {Promise<void>} Promise that resolves when complete or silently fails
 *   on unsupported platforms/devices.
 */
export async function successTap() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (error) {
    // Silently fail on web, older devices, or if module not ready
  }
}

/**
 * Warning notification feedback for caution or confirmation prompts.
 *
 * Triggers a warning-pattern haptic sequence (typically slower double-tap or
 * "buzz" sensation) suitable for alerting users: confirming parlay clear,
 * detecting stale snapshot. Uses Haptics.notificationAsync() with Warning
 * feedback type. Never awaited by callers (fire-and-forget).
 *
 * @returns {Promise<void>} Promise that resolves when complete or silently fails
 *   on unsupported platforms/devices.
 */
export async function warningTap() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch (error) {
    // Silently fail on web, older devices, or if module not ready
  }
}

/**
 * Error notification feedback for failures and error states.
 *
 * Triggers an error-pattern haptic sequence (typically irregular or "harsh"
 * sensation) suitable for signaling problems: fetch/network failure, validation
 * error, unrecoverable state. Uses Haptics.notificationAsync() with Error
 * feedback type. Never awaited by callers (fire-and-forget).
 *
 * @returns {Promise<void>} Promise that resolves when complete or silently fails
 *   on unsupported platforms/devices.
 */
export async function errorTap() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch (error) {
    // Silently fail on web, older devices, or if module not ready
  }
}
