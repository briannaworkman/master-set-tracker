import NetInfo from '@react-native-community/netinfo';
import { CollectionStore, createMemoryPriceCache, createMemoryRepo, type CollectionRepo, type PriceCache } from '@mst/collection-core';
import { FakeSyncRemote } from '@mst/collection-core/testing';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { Alert, AppState, Text } from 'react-native';
import AccountScreen from '../../app/account';
import { SIGN_OUT_SYNC_TIMEOUT_MS } from '../account/flows';
import HomeScreen from '../../app/index';
import { signedOutState, type AuthState } from '../auth/AuthProvider';
import { useTracked } from '../db/StoreContext';
import { SessionPriceProvider } from '../prices/PriceContext';
import { SyncSessionProvider, useSessionGate, useSyncSession } from '../sync/SyncProvider';
import { TestProviders, testAuth } from '../test/TestProviders';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  Stack: { Screen: () => null },
}));

const mockClient = {
  auth: { signOut: jest.fn() },
  functions: { invoke: jest.fn() },
};
jest.mock('../backend/supabase', () => ({ getSupabase: () => mockClient }));

type NetListener = (s: { isConnected: boolean | null }) => void;
const netListeners = new Set<NetListener>();
const appListeners = new Set<(s: string) => void>();
let startOnline = true;

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const setNetwork = (isConnected: boolean) =>
  act(async () => {
    netListeners.forEach((l) => l({ isConnected }));
    await jest.advanceTimersByTimeAsync(0);
  });

const userA: AuthState = { status: 'signedIn', userId: 'user-a', email: 'a@example.com', provider: 'email' };
const userB: AuthState = { status: 'signedIn', userId: 'user-b', email: 'b@example.com', provider: 'email' };

/** Sets the harness's auth state, as AuthProvider would on a Supabase auth event. */
let setAuth: (a: AuthState) => void = () => {};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-15T12:00:00.000Z') });
  netListeners.clear();
  appListeners.clear();
  startOnline = true;
  mockPush.mockClear();
  (NetInfo.addEventListener as jest.Mock).mockImplementation((l: NetListener) => {
    netListeners.add(l);
    l({ isConnected: startOnline });
    return () => netListeners.delete(l);
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, h: (s: string) => void) => {
    appListeners.add(h);
    return { remove: () => appListeners.delete(h) };
  }) as never);
  mockClient.auth.signOut.mockReset().mockImplementation(async () => {
    setAuth(signedOutState);
    return { error: null };
  });
  mockClient.functions.invoke.mockReset().mockResolvedValue({ data: { deleted: true }, error: null });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

interface Env {
  repo: CollectionRepo;
  store: CollectionStore;
  /** User A's rows on the server (RLS scopes every call to the signed-in user). */
  server: FakeSyncRemote;
  /** User B's rows on the server. */
  serverB: FakeSyncRemote;
  cache: PriceCache;
  fetchPrices: jest.Mock;
}

function setup(): Env {
  const repo = createMemoryRepo();
  return {
    repo,
    store: new CollectionStore(repo),
    server: new FakeSyncRemote(),
    serverB: new FakeSyncRemote(),
    cache: createMemoryPriceCache(),
    fetchPrices: jest.fn(async () => ({ 'c-001|normal': 2 })),
  };
}

let session!: ReturnType<typeof useSyncSession>;
/** Set ids a gated screen may show for the current user; anything else rendered is recorded. */
let allowedSets: string[] = [];
let leaked: string[] = [];

function LeakProbe() {
  const tracked = useTracked();
  for (const t of tracked) if (!allowedSets.includes(t.setId)) leaked.push(t.setId);
  return null;
}

/** The AuthGate's decision, without expo-router: app content only once the gate opens. */
function Gate({ children }: { children: ReactNode }) {
  const gate = useSessionGate();
  session = useSyncSession();
  if (gate !== 'signedIn') return <Text>{`gate: ${gate}`}</Text>;
  return (
    <>
      <LeakProbe />
      {children}
    </>
  );
}

function Harness({ env, initial, children }: { env: Env; initial: AuthState; children: ReactNode }) {
  const [auth, set] = useState(initial);
  setAuth = (a) => set(a);
  return (
    <TestProviders store={env.store} auth={auth}>
      <SyncSessionProvider repo={env.repo} remote={auth.userId === 'user-b' ? env.serverB : env.server} priceCache={env.cache}>
        <SessionPriceProvider cache={env.cache} fetchPrices={env.fetchPrices}>
          <Gate>{children}</Gate>
        </SessionPriceProvider>
      </SyncSessionProvider>
    </TestProviders>
  );
}

async function renderApp(env: Env, opts: { auth?: AuthState; allowed?: string[]; screen?: ReactNode } = {}) {
  leaked = [];
  allowedSets = opts.allowed ?? ['fx'];
  const view = await render(
    <Harness env={env} initial={opts.auth ?? userA}>
      {opts.screen ?? <AccountScreen />}
    </Harness>,
  );
  await advance(0);
  return view;
}

const alertButtons = (call = 0) =>
  (Alert.alert as jest.Mock).mock.calls[call]?.[2] as { text: string; style?: string; onPress?: () => void }[];

const pressAlert = (text: string, call = 0) =>
  act(async () => {
    alertButtons(call)
      .find((b) => b.text === text)!
      .onPress?.();
    await jest.advanceTimersByTimeAsync(0);
  });

const press = (name: string) =>
  act(async () => {
    fireEvent.press(screen.getByRole('button', { name }));
    await jest.advanceTimersByTimeAsync(0);
  });

describe('Account screen', () => {
  it('shows the email, the sync status and the account actions', async () => {
    await renderApp(setup());
    expect(screen.getByText('a@example.com')).toBeOnTheScreen();
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();
    for (const name of ['Sync now', 'Sign out', 'Delete account']) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }
  });

  it('says "Signed in with Apple" for a private relay address', async () => {
    await renderApp(setup(), {
      auth: { status: 'signedIn', userId: 'user-a', email: 'x7f2@privaterelay.appleid.com', provider: 'apple' },
    });
    expect(screen.getByText('Signed in with Apple')).toBeOnTheScreen();
    expect(screen.queryByText(/privaterelay/)).toBeNull();
  });

  it('syncs on "Sync now"', async () => {
    const env = setup();
    await renderApp(env);
    expect(env.server.pullCalls).toHaveLength(1);
    await press('Sync now');
    expect(env.server.pullCalls).toHaveLength(2);
  });

  it('is reached from an "Account" button on My Sets', async () => {
    await renderApp(setup(), { screen: <HomeScreen /> });
    await press('Account');
    expect(mockPush).toHaveBeenCalledWith('/account');
  });
});

describe('sign out', () => {
  it('with nothing pending: syncs, stops, wipes and signs out, in that order', async () => {
    const env = setup();
    env.store.track('fx');
    env.store.setCount('fx', 'c-001', 'normal', 2);
    env.cache.put('fx', new Date().toISOString(), { 'c-001|normal': 2 });
    await renderApp(env);
    jest.spyOn(Alert, 'alert');
    const order: string[] = [];
    const engine = session.engine!;
    const stop = jest.spyOn(engine, 'stop');
    const wipe = jest.spyOn(env.store, 'wipe').mockImplementation(function (this: CollectionStore) {
      order.push(stop.mock.calls.length > 0 ? 'wipe after stop' : 'wipe before stop');
      return CollectionStore.prototype.wipe.call(this);
    });
    mockClient.auth.signOut.mockImplementation(async () => {
      order.push('signOut');
      setAuth(signedOutState);
      return { error: null };
    });
    await act(async () => env.store.tap('fx', 'c-002', 'normal')); // pending until the sign-out sync

    await press('Sign out');

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(env.server.snapshot().collection.map((r) => r.cardId).sort()).toEqual(['c-001', 'c-002']);
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['wipe after stop', 'signOut']);
    expect(mockClient.auth.signOut).toHaveBeenCalledWith();
    expect(env.store.getTracked()).toEqual([]);
    expect(env.repo.countsForSet('fx')).toEqual({});
    expect(env.repo.getSyncState()).toEqual({ cursor: 0, lastSyncedAt: null });
    expect(env.repo.getLocalOwner()).toBeNull();
    expect(env.cache.get('fx')).toBeNull();
    expect(screen.getByText('gate: signedOut')).toBeOnTheScreen();
  });

  it('with changes that could not sync: warns, and Cancel keeps everything', async () => {
    startOnline = false;
    const env = setup();
    await renderApp(env);
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    await act(async () => env.store.tap('fx', 'c-002', 'normal'));
    jest.spyOn(Alert, 'alert');

    await press('Sign out');

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe(
      "2 changes haven't synced yet and will be lost. Sign out anyway?",
    );
    await pressAlert('Cancel');
    expect(mockClient.auth.signOut).not.toHaveBeenCalled();
    expect(env.repo.dirtyCount()).toBe(2);
    expect(env.store.getCounts('fx')).toEqual({ 'c-001:normal': 1, 'c-002:normal': 1 });
    expect(env.repo.getLocalOwner()).toBe('user-a');

    // The session is untouched: back online, the changes sync.
    await setNetwork(true);
    expect(env.server.snapshot().collection).toHaveLength(2);
  });

  it('uses the singular for one unsynced change, and signing out anyway wipes it', async () => {
    startOnline = false;
    const env = setup();
    await renderApp(env);
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    jest.spyOn(Alert, 'alert');
    await press('Sign out');
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe(
      "1 change hasn't synced yet and will be lost. Sign out anyway?",
    );
    expect(alertButtons().find((b) => b.text === 'Sign out')?.style).toBe('destructive');
    await pressAlert('Sign out');
    expect(env.repo.dirtyCount()).toBe(0);
    expect(env.store.getTracked()).toEqual([]);
    expect(mockClient.auth.signOut).toHaveBeenCalled();
    expect(env.server.snapshot().collection).toEqual([]);
  });

  it('stays signed in with an error when the wipe fails, and restarts sync', async () => {
    const env = setup();
    env.store.track('fx');
    await renderApp(env);
    const first = session.engine!;
    jest.spyOn(env.store, 'wipe').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    await press('Sign out');

    expect(screen.getByText("Couldn't sign out. Try again.")).toBeOnTheScreen();
    expect(mockClient.auth.signOut).not.toHaveBeenCalled();
    expect(env.store.getTracked().map((t) => t.setId)).toEqual(['fx']);
    expect(session.engine).not.toBeNull();
    expect(session.engine).not.toBe(first);
    // The fresh engine syncs local writes again.
    const pushes = env.server.pushCalls.length;
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    await advance(2000);
    expect(env.server.pushCalls.length).toBe(pushes + 1);
    errors.mockRestore();
  });

  it('still signs out locally when the server sign-out fails after the wipe', async () => {
    const env = setup();
    env.store.track('fx');
    await renderApp(env);
    mockClient.auth.signOut.mockImplementation(async (opts?: { scope?: string }) => {
      if (opts?.scope !== 'local') return { error: new Error('Network request failed') };
      setAuth(signedOutState);
      return { error: null };
    });

    await press('Sign out');

    expect(mockClient.auth.signOut).toHaveBeenNthCalledWith(1);
    expect(mockClient.auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(env.store.getTracked()).toEqual([]);
    expect(screen.getByText('gate: signedOut')).toBeOnTheScreen();
  });

  it('does not wait forever for a sync that hangs', async () => {
    const env = setup();
    env.store.track('fx');
    await renderApp(env);
    env.server.beforePush = () => new Promise(() => {});
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    jest.spyOn(Alert, 'alert');

    await press('Sign out');
    expect(Alert.alert).not.toHaveBeenCalled();
    await advance(SIGN_OUT_SYNC_TIMEOUT_MS);
    // The hung push never completed, so the change is still unsynced.
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe(
      "1 change hasn't synced yet and will be lost. Sign out anyway?",
    );
    await pressAlert('Sign out');
    expect(mockClient.auth.signOut).not.toHaveBeenCalled(); // stop() waits for the hung run…
    await advance(SIGN_OUT_SYNC_TIMEOUT_MS); // …but not forever: no write can follow stop()
    expect(env.store.getTracked()).toEqual([]);
    expect(mockClient.auth.signOut).toHaveBeenCalled();
    expect(screen.getByText('gate: signedOut')).toBeOnTheScreen();
  });

  it('releases the network and app-state listeners and pending retry timers', async () => {
    const env = setup();
    env.server.failNext('pull', new Error('pull_changes: permission denied'));
    await renderApp(env);
    expect(netListeners.size).toBeGreaterThan(0);
    expect(jest.getTimerCount()).toBeGreaterThan(0); // the 30 s retry, the status line tick
    await press('Sign out');

    expect(screen.getByText('gate: signedOut')).toBeOnTheScreen();
    expect(netListeners.size).toBe(0);
    expect(appListeners.size).toBe(0);
    await advance(1); // lets the press handling's zero-delay UI timers run
    expect(jest.getTimerCount()).toBe(0);
    const pulls = env.server.pullCalls.length;
    await advance(60 * 60_000);
    expect(env.server.pullCalls.length).toBe(pulls);
  });
});

describe('delete account', () => {
  it('confirms, calls the function, then wipes and signs out', async () => {
    const env = setup();
    env.store.track('fx');
    env.store.setCount('fx', 'c-001', 'normal', 3);
    await renderApp(env);
    jest.spyOn(Alert, 'alert');

    await press('Delete account');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete your account?',
      "This permanently deletes your account and every mark you've saved, on all devices. This can't be undone.",
      expect.any(Array),
      expect.anything(),
    );
    expect(alertButtons().find((b) => b.text === 'Delete account')?.style).toBe('destructive');
    expect(mockClient.functions.invoke).not.toHaveBeenCalled();

    await pressAlert('Delete account');

    expect(mockClient.functions.invoke).toHaveBeenCalledWith('delete-account', expect.anything());
    expect(env.store.getTracked()).toEqual([]);
    expect(env.repo.countsForSet('fx')).toEqual({});
    expect(mockClient.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByText('gate: signedOut')).toBeOnTheScreen();
  });

  it('changes nothing when cancelled', async () => {
    const env = setup();
    env.store.track('fx');
    await renderApp(env);
    jest.spyOn(Alert, 'alert');
    await press('Delete account');
    await pressAlert('Cancel');
    expect(mockClient.functions.invoke).not.toHaveBeenCalled();
    expect(env.store.getTracked().map((t) => t.setId)).toEqual(['fx']);
  });

  it.each([
    ['returns an error', () => mockClient.functions.invoke.mockResolvedValue({ data: null, error: new Error('Edge Function returned a non-2xx status code') })],
    ['throws', () => mockClient.functions.invoke.mockRejectedValue(new TypeError('Network request failed'))],
  ])('keeps everything and shows the error when the function %s', async (_label, arrange) => {
    arrange();
    const env = setup();
    env.store.track('fx');
    env.store.setCount('fx', 'c-001', 'normal', 3);
    await renderApp(env);
    const engine = session.engine;
    jest.spyOn(Alert, 'alert');
    await press('Delete account');
    await pressAlert('Delete account');

    expect(screen.getByText("Couldn't delete your account. Check your connection and try again.")).toBeOnTheScreen();
    expect(env.store.getTracked().map((t) => t.setId)).toEqual(['fx']);
    expect(env.store.getCounts('fx')).toEqual({ 'c-001:normal': 3 });
    expect(mockClient.auth.signOut).not.toHaveBeenCalled();
    expect(session.engine).toBe(engine);
  });
});

describe('another account signing in (R12)', () => {
  it("wipes the previous account's local data before any app screen renders", async () => {
    const env = setup();
    // User A's data, with unsynced changes and a price cache, left behind by a session that ended
    // without a sign-out (e.g. the refresh token expired).
    env.repo.setLocalOwner('user-a');
    env.store.track('fx');
    env.store.setCount('fx', 'c-001', 'normal', 2);
    env.repo.setSyncState({ cursor: 5, lastSyncedAt: '2026-11-14T12:00:00.000Z' });
    env.cache.put('fx', new Date().toISOString(), { 'c-001|normal': 9 });

    await renderApp(env, { auth: userB, allowed: [], screen: <HomeScreen /> });

    expect(leaked).toEqual([]);
    expect(screen.getByText('Add a set to start tracking')).toBeOnTheScreen();
    expect(env.repo.getLocalOwner()).toBe('user-b');
    expect(env.repo.countsForSet('fx')).toEqual({});
    expect(env.serverB.pushCalls).toHaveLength(0);
    expect(env.serverB.snapshot()).toEqual({ collection: [], tracked: [] });
    expect(env.serverB.pullCalls[0]?.cursor).toBe(0); // A's cursor went with the wipe
    expect(env.cache.get('fx')).toBeNull();
    expect(env.fetchPrices).not.toHaveBeenCalled();
  });

  it('wipes ownerless data that has sync history', async () => {
    const env = setup();
    env.store.track('fx');
    env.repo.setSyncState({ cursor: 3, lastSyncedAt: null });
    await renderApp(env, { auth: userB, allowed: [], screen: <HomeScreen /> });
    expect(leaked).toEqual([]);
    expect(env.store.getTracked()).toEqual([]);
    expect(env.serverB.snapshot().tracked).toEqual([]);
  });

  it('adopts ownerless data with no sync history (first launch after upgrading)', async () => {
    const env = setup();
    env.store.track('fx');
    await renderApp(env, { auth: userB, allowed: ['fx'], screen: <HomeScreen /> });
    expect(screen.getByText('Fixture Set')).toBeOnTheScreen();
    expect(env.repo.getLocalOwner()).toBe('user-b');
    expect(env.serverB.snapshot().tracked.map((t) => t.setId)).toEqual(['fx']);
  });

  it('after A signs out and B signs in, My Sets is empty', async () => {
    const env = setup();
    await renderApp(env, { screen: <AccountAndHome /> });
    await act(async () => env.store.track('fx'));
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    await advance(2000);
    const synced = env.server.snapshot();

    await press('Sign out');
    expect(screen.getByText('gate: signedOut')).toBeOnTheScreen();

    allowedSets = [];
    await act(async () => setAuth(userB));
    await advance(0);
    expect(screen.getByText('Add a set to start tracking')).toBeOnTheScreen();
    expect(env.repo.getLocalOwner()).toBe('user-b');
    // Nothing of A's was pushed under B, and A's synced rows are untouched.
    expect(env.serverB.pushCalls).toHaveLength(0);
    expect(env.server.snapshot()).toEqual(synced);
  });

  it('keeps the gate closed while the previous engine is still stopping', async () => {
    const env = setup();
    await renderApp(env, { screen: <HomeScreen />, allowed: ['fx'] });
    let release!: () => void;
    env.server.beforePull = () => new Promise<void>((r) => (release = r));
    await act(async () => env.store.track('fx'));
    await advance(2000); // a run is blocked in pull
    // A's session ends without a sign-out (no wipe), then B signs in.
    await act(async () => setAuth(signedOutState));
    allowedSets = [];
    await act(async () => setAuth(userB));
    await advance(0);
    expect(screen.getByText('gate: loading')).toBeOnTheScreen();
    env.server.beforePull = undefined;
    await act(async () => release());
    await advance(0);
    expect(screen.getByText('Add a set to start tracking')).toBeOnTheScreen();
    expect(leaked).toEqual([]);
    expect(env.serverB.pushCalls).toHaveLength(0);
  });
});

function AccountAndHome() {
  return (
    <>
      <AccountScreen />
      <HomeScreen />
    </>
  );
}
