import type { Session, SupabaseClient } from '@supabase/supabase-js';
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

const AuthContext = createContext<AuthState>(loadingState);

/** Exposed so tests can supply a fixed auth state without a Supabase client. */
export const AuthStateContext = AuthContext;

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ client, children }: { client: SupabaseClient; children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadingState);

  useEffect(() => {
    let live = true;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (live) setState(stateFromSession(session));
    });
    client.auth
      .getSession()
      .then(({ data: result }) => {
        // Only seed while still loading: a listener event is always at least as fresh.
        if (live) setState((current) => (current.status === 'loading' ? stateFromSession(result.session) : current));
      })
      .catch(() => {
        if (live) setState((current) => (current.status === 'loading' ? signedOutState : current));
      });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

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
