import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import RootLayout from '../../app/_layout';

const mockScreens: { name: string; options?: Record<string, unknown> }[] = [];

jest.mock('expo-router', () => {
  const Stack = ({ children }: { children: ReactNode }) => children;
  Stack.Screen = (props: { name: string; options?: Record<string, unknown> }) => {
    mockScreens.push(props);
    return null;
  };
  Stack.Protected = ({ guard, children }: { guard: boolean; children: ReactNode }) => (guard ? children : null);
  return { Stack };
});

jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true) }));

let mockAuthStatus = 'signedIn';
jest.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: mockAuthStatus, userId: mockAuthStatus === 'signedIn' ? 'user-1' : null, email: null, provider: null }),
}));
const mockSignOut = jest.fn(async (_opts?: unknown): Promise<{ error: Error | null }> => ({ error: null }));
let mockStoredSession = true;
const mockGetSession = jest.fn(async () => ({ data: { session: mockStoredSession ? {} : null }, error: null }));
jest.mock('../backend/supabase', () => ({ getSupabase: () => ({ auth: { signOut: mockSignOut, getSession: mockGetSession } }) }));

// The real provider renders nothing until native inset metrics arrive.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

let mockOpenError: Error | null = null;
let mockOwnerError: Error | null = null;
jest.mock('../db/openStore', () => {
  const { CollectionStore, createMemoryPriceCache, createMemoryRepo } = jest.requireActual('@mst/collection-core');
  return {
    getAppStore: () => {
      if (mockOpenError) throw mockOpenError;
      const repo = createMemoryRepo();
      const getLocalOwner = repo.getLocalOwner;
      repo.getLocalOwner = () => {
        if (mockOwnerError) throw mockOwnerError;
        return getLocalOwner();
      };
      return { store: new CollectionStore(repo), repo, priceCache: createMemoryPriceCache(), persistent: true };
    },
  };
});

beforeEach(() => {
  mockScreens.length = 0;
  mockOpenError = null;
  mockOwnerError = null;
  mockAuthStatus = 'signedIn';
  mockSignOut.mockClear();
  mockStoredSession = true;
});

it('titles the home screen "My Sets" so back buttons never read "index"', async () => {
  await render(<RootLayout />);
  const home = mockScreens.find((s) => s.name === 'index');
  expect(home?.options).toMatchObject({ title: 'My Sets', headerShown: false });
});

it('shows a full-screen message instead of crashing when the collection database cannot open', async () => {
  mockOpenError = new Error('database disk image is malformed');
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  await render(<RootLayout />);
  expect(logged).toHaveBeenCalledWith('Could not open the collection database', mockOpenError);
  logged.mockRestore();
  expect(screen.getByText("Couldn't open your collection")).toBeOnTheScreen();
  // __DEV__ is true under jest, so the underlying error is shown for debugging.
  expect(screen.getByText('database disk image is malformed')).toBeOnTheScreen();
  expect(mockScreens).toEqual([]);
});

it('registers only the sign-in routes while signed out', async () => {
  mockAuthStatus = 'signedOut';
  await render(<RootLayout />);
  expect(mockScreens.map((s) => s.name)).toEqual(['sign-in', 'sign-in-email']);
});

it('renders no routes while the session is loading', async () => {
  mockAuthStatus = 'loading';
  await render(<RootLayout />);
  expect(mockScreens).toEqual([]);
});

it('registers only the app routes while signed in', async () => {
  await render(<RootLayout />);
  expect(mockScreens.map((s) => s.name)).toEqual([
    'index',
    'browse',
    'account',
    'set/[id]/index',
    'set/[id]/settings',
    'set/[id]/card/[cardId]',
  ]);
});

it('declares every route file in the signed-in or sign-in group', async () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const root = path.join(__dirname, '../../app');
  const files: string[] = [];
  const walk = (dir: string) =>
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.relative(root, path.join(dir, e.name))),
    );
  walk(root);
  const routes = files.map((f) => f.replace(/\.tsx?$/, '')).filter((f) => f !== '_layout');
  await render(<RootLayout />);
  const signedIn = mockScreens.map((s) => s.name);
  mockScreens.length = 0;
  mockAuthStatus = 'signedOut';
  await render(<RootLayout />);
  const declared = [...signedIn, ...mockScreens.map((s) => s.name)];
  expect([...declared].sort()).toEqual([...routes].sort());
});

it('titles the account screen "Account"', async () => {
  await render(<RootLayout />);
  expect(mockScreens.find((s) => s.name === 'account')?.options).toMatchObject({ title: 'Account' });
});

it('shows no routes, and offers sign-out, when the local data cannot be checked for the user', async () => {
  mockOwnerError = new Error('database is locked');
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  await render(<RootLayout />);
  logged.mockRestore();
  expect(mockScreens).toEqual([]);
  expect(screen.getByText("Couldn't open your collection")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
});

it('guards the error screen sign-out against double taps and shows its failure', async () => {
  mockOwnerError = new Error('database is locked');
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  let finish!: (r: { error: Error | null }) => void;
  mockSignOut.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  await render(<RootLayout />);
  logged.mockRestore();
  const button = screen.getByRole('button', { name: 'Sign out' });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  await act(async () => finish({ error: new Error('Keychain unavailable') }));
  expect(screen.getByText("Couldn't sign out. Try again.")).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
});

it('treats the error screen sign-out as done when the session is gone despite a failed revoke', async () => {
  mockOwnerError = new Error('database is locked');
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockSignOut.mockImplementationOnce(async () => {
    mockStoredSession = false; // auth-js removed the session, then the revoke request failed
    return { error: new Error('Network request failed') };
  });
  await render(<RootLayout />);
  logged.mockRestore();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(mockGetSession).toHaveBeenCalled();
  expect(screen.queryByText("Couldn't sign out. Try again.")).toBeNull();
});

it('keeps the splash up while loading and hides it on the first auth result', async () => {
  (SplashScreen.hideAsync as jest.Mock).mockClear();
  mockAuthStatus = 'loading';
  const view = await render(<RootLayout />);
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  mockAuthStatus = 'signedOut';
  await view.rerender(<RootLayout />);
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
});
