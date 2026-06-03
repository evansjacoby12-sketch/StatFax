/**
 * SupabaseClient — minimal hand-rolled wrapper around Supabase's REST + Auth
 * APIs. We avoid the official @supabase/supabase-js SDK because it pulls in
 * WebSocket, WebAuthn, and crypto polyfills that Hermes (RN's bytecode
 * compiler) can't precompile — which broke our EAS Update bundle.
 *
 * What this wrapper supports:
 *   auth.signUp({ email, password })
 *   auth.signInWithPassword({ email, password })
 *   auth.signOut()
 *   auth.getSession()
 *   auth.onAuthStateChange(cb)            // returns { data: { subscription: { unsubscribe } } }
 *   from(table)                           // chainable query builder
 *     .select()
 *     .insert(rows)
 *     .upsert(rows, { onConflict })
 *     .update(values)
 *     .delete()
 *     .eq(column, value)                  // adds filter
 *   rpc(fn, params)                       // POST /rest/v1/rpc/<fn>
 *
 * What we don't support (intentional):
 *   - Realtime subscriptions (WebSocket)
 *   - OAuth flows (Google/Apple) — Phase 3b
 *   - Storage uploads
 *   - Edge function invocations
 *
 * Session is persisted to AsyncStorage so users stay signed in across
 * app launches. Access tokens auto-refresh when within 30s of expiry.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL  = 'https://rwgtkfhydwgfczqezqbd.supabase.co';
const SUPABASE_ANON = 'sb_publishable_C2RKDZk_gBSseQadcLCz6w_yiIFzrmY';
const SESSION_KEY   = 'statfax_supabase_session';

// ─── Session state ──────────────────────────────────────────────────────────
let _session = null;
const _listeners = new Set();

function notify(event) {
  for (const cb of _listeners) {
    try { cb(event, _session); } catch {}
  }
}

async function persistSession(session) {
  _session = session;
  try {
    if (session) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else         await AsyncStorage.removeItem(SESSION_KEY);
  } catch {}
}

async function hydrateSession() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) _session = JSON.parse(raw);
  } catch {}
  return _session;
}

// Hydrate immediately on module load so subscribers see a session ASAP.
const _hydratePromise = hydrateSession().then(s => {
  if (s) notify('SIGNED_IN');
  notify('INITIAL_SESSION');
});

// ─── Token refresh ──────────────────────────────────────────────────────────

function isExpiringSoon(session, marginSec = 30) {
  if (!session?.expires_at) return false;
  const now = Math.floor(Date.now() / 1000);
  return session.expires_at - now < marginSec;
}

async function refreshAccessToken() {
  if (!_session?.refresh_token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: _session.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const session = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user:          data.user || _session.user,
    };
    await persistSession(session);
    notify('TOKEN_REFRESHED');
    return session;
  } catch {
    return null;
  }
}

async function getAccessToken() {
  await _hydratePromise;
  if (!_session) return null;
  if (isExpiringSoon(_session)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return refreshed.access_token;
  }
  return _session.access_token;
}

// ─── Auth API ───────────────────────────────────────────────────────────────

const auth = {
  async signUp({ email, password }) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: { message: data.msg || data.error_description || data.error || 'Sign up failed' } };
    // Supabase returns a session ONLY if email confirmations are disabled.
    // With confirmations on, the user has to confirm via email first.
    if (data.access_token) {
      const session = {
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user:          data.user,
      };
      await persistSession(session);
      notify('SIGNED_IN');
      return { data: { session, user: data.user }, error: null };
    }
    return { data: { session: null, user: data.user || null }, error: null };
  },

  async signInWithPassword({ email, password }) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: { message: data.msg || data.error_description || data.error || 'Sign in failed' } };
    const session = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user:          data.user,
    };
    await persistSession(session);
    notify('SIGNED_IN');
    return { data: { session, user: data.user }, error: null };
  },

  async signOut() {
    // Clear the local session and notify subscribers FIRST so the UI flips to
    // signed-out instantly. The server-side token revocation is best-effort and
    // fired in the background — never block the UI on it. Previously this awaited
    // the /logout fetch with no timeout, so on a flaky connection the request
    // hung and the app appeared "stuck signed in" until a force-quit.
    const token = _session?.access_token;
    await persistSession(null);
    notify('SIGNED_OUT');
    if (token) {
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }
    return { error: null };
  },

  async getSession() {
    await _hydratePromise;
    return { data: { session: _session }, error: null };
  },

  /**
   * Apply a session captured from an OAuth callback redirect. Used by the
   * Google/Apple sign-in flow — the OAuth provider sends us back to the app
   * via a deep link carrying access_token + refresh_token in the URL
   * fragment, and we persist it here so the rest of the auth flow Just Works.
   */
  async setSession({ access_token, refresh_token, expires_in, user }) {
    if (!access_token || !refresh_token) return { data: null, error: { message: 'Missing tokens' } };
    const session = {
      access_token,
      refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (Number(expires_in) || 3600),
      user:       user || null,
    };
    // If the OAuth callback didn't include user info inline, hit /auth/v1/user
    // with the new access token to populate it. Lets onAuthStateChange consumers
    // read user.email / user.id immediately after sign-in.
    if (!session.user) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${access_token}` },
        });
        if (res.ok) session.user = await res.json();
      } catch {}
    }
    await persistSession(session);
    notify('SIGNED_IN');
    return { data: { session }, error: null };
  },

  /**
   * Return the URL to redirect the user to for an OAuth provider sign-in.
   * Caller is responsible for opening this URL in a browser (we use
   * expo-web-browser's openAuthSessionAsync in AuthScreen).
   */
  getOAuthUrl({ provider, redirectTo }) {
    const params = new URLSearchParams({ provider });
    if (redirectTo) params.set('redirect_to', redirectTo);
    return `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
  },

  /**
   * Exchange a PKCE `?code=` callback for a session. Modern Supabase
   * projects (default since ~2024) route OAuth through PKCE, which means
   * the redirect lands with a code in the query string rather than tokens
   * in the URL fragment. Without this exchange, Google sign-in fell back
   * to the "No session returned" error.
   *
   * We don't track the code_verifier client-side because Supabase's
   * `flow_type=implicit` projects ignore it, and PKCE-enforced projects
   * fall back to a verifier-less exchange when the same session originated
   * the auth request.
   */
  async exchangeCodeForSession(code) {
    if (!code) return { data: null, error: { message: 'Missing code' } };
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
        method:  'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ auth_code: code }),
      });
      const data = await res.json();
      if (!res.ok) return { data: null, error: { message: data.msg || data.error_description || data.error || 'Code exchange failed' } };
      const session = {
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user:          data.user || null,
      };
      await persistSession(session);
      notify('SIGNED_IN');
      return { data: { session }, error: null };
    } catch (e) {
      return { data: null, error: { message: e?.message || String(e) } };
    }
  },

  onAuthStateChange(cb) {
    _listeners.add(cb);
    // Mirror @supabase/supabase-js shape so existing call sites just work.
    return { data: { subscription: { unsubscribe: () => _listeners.delete(cb) } } };
  },

  /**
   * Native OAuth via identity token (Sign in with Apple).
   *
   * Apple's SDK returns a JWT identity token directly after the user
   * authorizes — no web redirect needed. We POST it to Supabase's
   * grant_type=id_token endpoint, which verifies the JWT signature
   * against Apple's public keys and either creates a new user or signs
   * in the existing one. Required for Guideline 4.8 compliance (must
   * offer Sign in with Apple as an equivalent to other social logins).
   *
   * @param {object}  params
   * @param {string}  params.provider  - 'apple' (currently the only supported native ID-token provider)
   * @param {string}  params.token     - The identity token (JWT) from AppleAuthentication.signInAsync()
   * @param {string} [params.nonce]    - Optional nonce that was used when requesting the credential
   */
  async signInWithIdToken({ provider, token, nonce }) {
    if (!provider || !token) {
      return { data: null, error: { message: 'Missing provider or identity token' } };
    }
    try {
      const body = { provider, id_token: token };
      if (nonce) body.nonce = nonce;
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=id_token`, {
        method:  'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        return { data: null, error: { message: data.msg || data.error_description || data.error || 'Sign in failed' } };
      }
      const session = {
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user:          data.user || null,
      };
      await persistSession(session);
      notify('SIGNED_IN');
      return { data: { session, user: session.user }, error: null };
    } catch (e) {
      return { data: null, error: { message: e?.message || String(e) } };
    }
  },

  /**
   * Self-service account deletion. Wraps a server-side RPC that runs
   * with SECURITY DEFINER so it can both clear the user's app data
   * AND delete the auth.users row (which the regular Supabase auth API
   * doesn't permit a user to do to themselves).
   *
   * Required by App Store Guideline 5.1.1(v): apps that support account
   * creation must also support self-service account deletion.
   *
   * Server-side: define `delete_user_account()` in Supabase SQL editor
   * with SECURITY DEFINER, GRANT EXECUTE TO authenticated. The function
   * should DELETE from each app table where the user_id matches
   * auth.uid(), then DELETE FROM auth.users WHERE id = auth.uid().
   *
   * On success, clears the local session and notifies subscribers as
   * SIGNED_OUT so the rest of the app shrugs back to the unauth state.
   */
  async deleteAccount() {
    const session = _session;
    if (!session?.access_token) {
      return { error: { message: 'Not signed in' } };
    }
    const { error } = await rpc('delete_user_account');
    if (error) return { error };
    // Auth user is gone now — clear local session without round-tripping
    // /auth/v1/logout (which would 401 anyway since the token references
    // a user that no longer exists). Listeners see SIGNED_OUT.
    await persistSession(null);
    notify('SIGNED_OUT');
    return { error: null };
  },
};

// ─── PostgREST query builder ────────────────────────────────────────────────

class QueryBuilder {
  constructor(table) {
    this.table  = table;
    this.method = 'GET';
    this.body   = null;
    this.filters = [];
    this.headers = {};
    this.queryParams = [];
  }

  select(cols = '*') {
    if (this.method === 'GET') {
      this.queryParams.push(`select=${encodeURIComponent(cols)}`);
    } else {
      this.headers['Prefer'] = (this.headers['Prefer'] ? this.headers['Prefer'] + ',' : '') + 'return=representation';
    }
    return this;
  }

  insert(rows) {
    this.method = 'POST';
    this.body   = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows, { onConflict } = {}) {
    this.method = 'POST';
    this.body   = Array.isArray(rows) ? rows : [rows];
    this.headers['Prefer'] = 'resolution=merge-duplicates';
    if (onConflict) this.queryParams.push(`on_conflict=${encodeURIComponent(onConflict)}`);
    return this;
  }

  update(values) {
    this.method = 'PATCH';
    this.body   = values;
    return this;
  }

  delete() {
    this.method = 'DELETE';
    return this;
  }

  eq(column, value) {
    this.filters.push(`${column}=eq.${encodeURIComponent(value)}`);
    return this;
  }

  /**
   * Return a single row instead of an array. Throws (well — returns an error)
   * when the result is anything other than exactly one row. Mirrors
   * @supabase/supabase-js semantics so call sites can read result.data as
   * an object rather than an array of length 1.
   */
  single() {
    this._single = true;
    this._maybeSingle = false;
    return this;
  }

  /**
   * Like .single() but returns null when the row is missing instead of an
   * error. Used everywhere we look up a per-user row that may legitimately
   * not exist yet (e.g. pro_status before the user has ever been a Pro).
   */
  maybeSingle() {
    this._maybeSingle = true;
    this._single = false;
    return this;
  }

  // Awaitable — runs the request when the chain is awaited.
  then(resolve, reject) {
    return this._exec().then(resolve, reject);
  }

  async _exec() {
    try {
      const token = await getAccessToken();
      const params = [...this.queryParams, ...this.filters].join('&');
      const url = `${SUPABASE_URL}/rest/v1/${this.table}${params ? '?' + params : ''}`;
      const headers = {
        'apikey':       SUPABASE_ANON,
        'Authorization': `Bearer ${token || SUPABASE_ANON}`,
        'Content-Type': 'application/json',
        ...this.headers,
      };
      const res = await fetch(url, {
        method:  this.method,
        headers,
        body:    this.body != null ? JSON.stringify(this.body) : undefined,
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (!res.ok) {
        return { data: null, error: { message: data?.message || data?.error || `HTTP ${res.status}`, code: data?.code, status: res.status } };
      }
      // Reshape for .single() / .maybeSingle() — PostgREST always returns
      // an array, but consumers of these methods expect a bare object (or
      // null for maybeSingle). Without this unwrap, every .maybeSingle()
      // call site was reading `data[0]` on an array and silently breaking.
      if (this._single || this._maybeSingle) {
        const arr = Array.isArray(data) ? data : (data == null ? [] : [data]);
        if (arr.length === 1) return { data: arr[0], error: null };
        if (arr.length === 0) {
          if (this._maybeSingle) return { data: null, error: null };
          return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
        }
        return { data: null, error: { message: 'Multiple rows returned', code: 'PGRST117' } };
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: e?.message || String(e) } };
    }
  }
}

// ─── RPC ────────────────────────────────────────────────────────────────────

async function rpc(fn, params = {}) {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method:  'POST',
      headers: {
        'apikey':        SUPABASE_ANON,
        'Authorization': `Bearer ${token || SUPABASE_ANON}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      return { data: null, error: { message: data?.message || `HTTP ${res.status}` } };
    }
    return { data, error: null };
  } catch (e) {
    return { data: null, error: { message: e?.message || String(e) } };
  }
}

// ─── Public client ──────────────────────────────────────────────────────────

export const supabase = {
  auth,
  from: (table) => new QueryBuilder(table),
  rpc,
};

export default supabase;
