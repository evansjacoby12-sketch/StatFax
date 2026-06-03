/**
 * pushNotifications — Expo push token registration for server-driven
 * notifications.
 *
 * Phase 4.5 wires up the CLIENT side of push:
 *   1. Get the user's notification permission (already prompted by the
 *      existing local-notifications setup in src/utils/notifications.js)
 *   2. Fetch the Expo push token for this device
 *   3. Upsert it to Supabase's `user_push_tokens` table (RLS-scoped to the
 *      signed-in user) so a future server function can target this device
 *
 * Phase 4.6 (later session) will add the SERVER side:
 *   - Supabase Edge Function that loops eligible push tokens and POSTs to
 *     https://exp.host/--/api/v2/push/send with the alert body
 *   - Triggers: daily slate ready, watchlist player in lineup, watchlist
 *     player homers, parlay leg confirmed
 *
 * If the user isn't signed in, we skip registration — push delivery
 * requires a user_id to scope the token to. Local-only notifications
 * (scheduled by the device) still work unchanged.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../api/SupabaseClient';

const PROJECT_ID = '789c6263-5838-44db-b20b-6b6c3347a2de';   // matches app.json extra.eas.projectId

/**
 * Get the Expo push token for this device. Returns null on:
 *   - Simulator / web (Expo push doesn't deliver to either)
 *   - Permission not granted
 *   - Token fetch failure
 *
 * Safe to call any time after the user has granted notification permissions.
 */
export async function getExpoPushToken() {
  // Push tokens are only meaningful on physical iOS/Android devices.
  if (!Device.isDevice) return null;
  if (Platform.OS === 'web') return null;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    return data || null;
  } catch {
    return null;
  }
}

/**
 * Register the current device's push token with Supabase for the signed-in
 * user. No-op if not authed or no token available. Idempotent — re-running
 * just refreshes `last_seen` so we can prune stale device entries later.
 */
export async function registerPushToken(userId) {
  if (!userId) return { ok: false, reason: 'not_authenticated' };
  const token = await getExpoPushToken();
  if (!token) return { ok: false, reason: 'no_token' };
  try {
    const { error } = await supabase.from('user_push_tokens').upsert({
      user_id:     userId,
      token,
      platform:    Platform.OS,
      device_name: Device.modelName || Device.deviceName || null,
      last_seen:   new Date().toISOString(),
    }, { onConflict: 'user_id,token' });
    if (error) return { ok: false, reason: 'db_error', error };
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: 'exception', error: e?.message };
  }
}

/**
 * Remove this device's token from Supabase on sign-out. Prevents stale
 * tokens from receiving pushes for users who've signed out of the app.
 *
 * If we can't recover the device token (permission revoked, simulator,
 * Expo push service unreachable) we still want to scrub THIS user's rows
 * — otherwise a signed-out account keeps receiving pushes targeted at
 * `user_id`. Fall back to a user-scoped delete in that case.
 */
export async function unregisterPushToken(userId) {
  if (!userId) return;
  const token = await getExpoPushToken();
  try {
    if (token) {
      await supabase.from('user_push_tokens').delete().eq('user_id', userId).eq('token', token);
    } else {
      await supabase.from('user_push_tokens').delete().eq('user_id', userId);
    }
  } catch {}
}
