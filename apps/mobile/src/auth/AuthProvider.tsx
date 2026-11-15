import { isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { isNetworkError } from '@mst/collection-core';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  userId: string | null;
  email: string | null;
  provider: string | null;
}

export const signedOutState: AuthState = { status: 'signedOut', userId: null, email: null, provider: null };
const loadingState: AuthState = { ...signedOutState, status: 'loading' };

export function stateFromSession(session: Session | null): AuthState {
  if (!session) return signedOutState;
  return {
    status: 'signedIn',
    userId: session.user.id,
    email: session.user.email ?? null,
    provider: (session.user.app_metadata?.provider as string | undefined) ?? null,
  };
}

/**
 * The signed-in state recorded in the raw stored session (the JSON auth-js writes under its
 * storage key), or null unless it holds a user id and a refresh token. Used only when auth-js
 * reports no session at start-up even though one may still be stored (see AuthProvider).
 */
export function stateFromStoredSession(raw: string | null): AuthState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const s = parsed as { refresh_token?: unknown; user?: { id?: unknown; email?: unknown; app_metadata?: { provider?: unknown } } } | null;
  const user = s?.user;
  if (typeof user?.id !== 'string' || user.id === '') return null;
  if (typeof s?.refresh_token !== 'string' || s.refresh_token === '') return null;
  const provider = user.app_metadata?.provider;
  return {
    status: 'signedIn',
    userId: user.id,
    email: typeof user.email === 'string' ? user.email : null,
    provider: typeof provider === 'string' ? provider : null,
  };
}

/** How long the initial session load may take before the stored-session check decides. */
export const INITIAL_LOAD_TIMEOUT_MS = 10_000;

const AuthContext = createContext<AuthState>(loadingState);

/** Exposed so tests can supply a fixed auth state without a Supabase client. */
export const AuthStateContext = AuthContext;

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/**
 * Follows the Supabase auth state. Offline-first start-up: when the stored access token has
 * expired and the refresh fails for a retryable reason (offline, 5xx), auth-js keeps the session
 * in storage but reports none (getSession → { session: null, error }, INITIAL_SESSION → null).
 * The app must still open for that user, so in that case — and if the initial load takes longer
 * than INITIAL_LOAD_TIMEOUT_MS (auth-js retries a failing refresh for up to ~25 s, and a request
 * can hang) — the raw stored session is read with `readStoredSession` (same storage and key as
 * the client): a user id plus a refresh token means signed in, anything else signed out. Sync
 * then shows offline until a refresh succeeds (TOKEN_REFRESHED); a rejected refresh removes the
 * session and fires SIGNED_OUT, which signs out. Only the initial state is decided this way:
 * every later auth event is applied as it comes.
 */
export function AuthProvider({
  client,
  readStoredSession,
  children,
}: {
  client: SupabaseClient;
  /** Reads the raw stored session (JSON) from the client's own storage and storage key. */
  readStoredSession: () => Promise<string | null>;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>(loadingState);

  useEffect(() => {
    let live = true;
    /** Sets the initial state; ignored once any state has been decided. */
    const settle = (next: AuthState) => {
      if (live) setState((current) => (current.status === 'loading' ? next : current));
    };
    const settleFromStorage = async () => {
      let raw: string | null = null;
      try {
        raw = await readStoredSession();
      } catch (e) {
        console.warn('Could not read the stored session', e instanceof Error ? e.name : typeof e);
      }
      settle(stateFromStoredSession(raw) ?? signedOutState);
    };

    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!live) return;
      if (session) setState(stateFromSession(session));
      // auth-js emits a null INITIAL_SESSION for any load error, including a retryable refresh
      // failure that kept the session in storage.
      else if (event === 'INITIAL_SESSION') void settleFromStorage();
      else setState(signedOutState);
    });
    client.auth.getSession().then(
      ({ data: result, error }) => {
        if (result.session) settle(stateFromSession(result.session));
        else if (error && (isAuthRetryableFetchError(error) || isNetworkError(error))) void settleFromStorage();
        else settle(signedOutState);
      },
      () => void settleFromStorage(),
    );
    const timer = setTimeout(() => void settleFromStorage(), INITIAL_LOAD_TIMEOUT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, [client, readStoredSession]);

  // Supabase's React Native recommendation: refresh tokens only while the app is in the foreground.
  useEffect(() => {
    const apply = (s: string | null | undefined) => {
      if (s === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };
    apply(AppState.currentState);
    const sub = AppState.addEventListener('change', apply);
    return () => {
      sub.remove();
      client.auth.stopAutoRefresh();
    };
  }, [client]);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
