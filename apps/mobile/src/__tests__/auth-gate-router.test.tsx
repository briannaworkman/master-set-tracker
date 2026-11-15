import { renderRouter, screen } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

// Real expo-router and the real app/ directory: proves signed-out users can reach only the sign-in routes.
let mockAuthStatus = 'signedOut';
jest.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: mockAuthStatus, userId: null, email: null, provider: null }),
}));
jest.mock('../backend/supabase', () => ({ getSupabase: () => ({ auth: {} }) }));
jest.mock('../backend/config', () => ({
  backendConfig: { googleIosClientId: null, googleWebClientId: null, supabaseUrl: '', supabaseAnonKey: '' },
}));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true) }));
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn(async () => false) }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('../db/openStore', () => {
  const { CollectionStore, createMemoryPriceCache, createMemoryRepo } = jest.requireActual('@mst/collection-core');
  const repo = createMemoryRepo();
  const opened = { store: new CollectionStore(repo), repo, priceCache: createMemoryPriceCache(), persistent: true };
  return { getAppStore: () => opened };
});

const protectedPaths = ['/', '/browse', '/set/fx', '/set/fx/settings', '/set/fx/card/c-001'];

beforeEach(() => {
  mockAuthStatus = 'signedOut';
});

describe.each(protectedPaths)('signed out, deep link to %s', (path) => {
  it('lands on sign-in', async () => {
    await renderRouter('./app', { initialUrl: path });
    expect(await screen.findByText('Track every version of every card.')).toBeOnTheScreen();
    expect(screen).toHavePathname('/sign-in');
  });
});

it('shows the app when signed in', async () => {
  mockAuthStatus = 'signedIn';
  await renderRouter('./app', { initialUrl: '/' });
  expect(await screen.findByText('My Sets')).toBeOnTheScreen();
  expect(screen).toHavePathname('/');
});
