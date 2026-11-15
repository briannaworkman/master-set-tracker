// Cold start against the real supabase-js client (real auth-js session recovery and refresh),
// with expo-secure-store as an in-memory map and fetch controlled per test.
import type { SupabaseClient } from '@supabase/supabase-js';
import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import RootLayout from '../../app/_layout';
import { INITIAL_LOAD_TIMEOUT_MS } from '../auth/AuthProvider';

const mockScreens: string[] = [];
jest.mock('expo-router', () => {
  const Stack = ({ children }: { children: ReactNode }) => children;
  Stack.Screen = (props: { name: string }) => {
    mockScreens.push(props.name);
    return null;
  };
  Stack.Protected = ({ guard, children }: { guard: boolean; children: ReactNode }) => (guard ? children : null);
  return { Stack };
});
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockSecure.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockSecure.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockSecure.delete(k);
  }),
}));

jest.mock('../db/openStore', () => {
  const { CollectionStore, createMemoryPriceCache, createMemoryRepo } = jest.requireActual('@mst/collection-core');
  return {
    getAppStore: () => {
      const repo = createMemoryRepo();
      return { store: new CollectionStore(repo), repo, priceCache: createMemoryPriceCache(), persistent: true };
    },
  };
});

// A fresh real client per test (the app's singleton would carry auth state between tests).
let mockClient: SupabaseClient | null = null;
jest.mock('../backend/supabase', () => {
  const actual = jest.requireActual('../backend/supabase');
  return { ...actual, getSupabase: () => (mockClient ??= actual.createSupabaseClient()) };
});

// jest.setup.js sets EXPO_PUBLIC_SUPABASE_URL to https://test-project.supabase.co.
const KEY = 'sb-test-project-auth-token';
const NOW = new Date('2026-11-15T12:00:00.000Z');

/** A session whose access token expired an hour ago, as auth-js stores it. */
function storeExpiredSession() {
  mockSecure.set(
    KEY,
    JSON.stringify({
      access_token: 'expired-jwt',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(NOW.getTime() / 1000) - 3600,
      refresh_token: 'refresh-1',
      user: { id: 'user-offline', email: 'o@example.com', app_metadata: { provider: 'email' } },
    }),
  );
}

const APP_ROUTES = ['index', 'browse', 'account', 'set/[id]/index', 'set/[id]/settings', 'set/[id]/card/[cardId]'];
const SIGN_IN_ROUTES = ['sign-in', 'sign-in-email'];
/** The routes of the latest render (each render re-registers every screen). */
const routes = () => {
  if (mockScreens.length === 0) return [];
  const last = mockScreens.lastIndexOf(mockScreens.includes('index') ? 'index' : 'sign-in');
  return mockScreens.slice(last, last + (mockScreens[last] === 'index' ? APP_ROUTES.length : SIGN_IN_ROUTES.length));
};
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

const fetchMock = jest.fn();
const realFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  mockScreens.length = 0;
  mockSecure.clear();
  mockClient = null;
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('offline with an expired access token: opens to My Sets within the start-up cap and stays there', async () => {
  storeExpiredSession();
  fetchMock.mockImplementation(async () => {
    throw new TypeError('Network request failed');
  });
  await render(<RootLayout />);
  await advance(INITIAL_LOAD_TIMEOUT_MS);
  expect(routes()).toEqual(APP_ROUTES);
  // auth-js gives up retrying the refresh (~25 s) and reports no session: still signed in.
  await advance(30_000);
  expect(routes()).toEqual(APP_ROUTES);
  expect(mockSecure.get(KEY)).toBeDefined();
});

it('a rejected refresh (dead refresh token) lands on sign-in', async () => {
  storeExpiredSession();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/token')) {
      return new Response(
        JSON.stringify({ code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new TypeError('Network request failed');
  });
  await render(<RootLayout />);
  await advance(INITIAL_LOAD_TIMEOUT_MS + 1000);
  expect(routes()).toEqual(SIGN_IN_ROUTES);
  expect(mockSecure.get(KEY)).toBeUndefined();
});

it('a hung refresh request: opens to My Sets once the start-up cap passes', async () => {
  storeExpiredSession();
  fetchMock.mockImplementation(() => new Promise(() => {}));
  await render(<RootLayout />);
  await advance(INITIAL_LOAD_TIMEOUT_MS - 1);
  expect(routes()).toEqual([]);
  await advance(1);
  expect(routes()).toEqual(APP_ROUTES);
});

it('no stored session: sign-in at once', async () => {
  await render(<RootLayout />);
  await advance(0);
  expect(routes()).toEqual(SIGN_IN_ROUTES);
  expect(fetchMock).not.toHaveBeenCalled();
});
