import NetInfo from '@react-native-community/netinfo';
import { CollectionStore, createMemoryPriceCache, createMemoryRepo, type CollectionRepo, type PriceCache } from '@mst/collection-core';
import { FakeSyncRemote } from '@mst/collection-core/testing';
import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, AppState, Text } from 'react-native';
import HomeScreen from '../../app/index';
import SetScreen from '../../app/set/[id]/index';
import { signedOutState, type AuthState } from '../auth/AuthProvider';
import { SyncStatusLine } from '../components/SyncStatusLine';
import { RefreshingPriceProvider } from '../prices/PriceContext';
import { formatSyncedAgo } from '../sync/relativeTime';
import { SyncSessionProvider, useSyncSession } from '../sync/SyncProvider';
import { TestProviders, testAuth } from '../test/TestProviders';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'fx' }),
  Stack: { Screen: () => null },
  useFocusEffect: () => {},
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

type NetListener = (s: { isConnected: boolean | null }) => void;
const netListeners = new Set<NetListener>();
const appListeners = new Set<(s: string) => void>();

const setNetwork = (isConnected: boolean) =>
  act(async () => {
    netListeners.forEach((l) => l({ isConnected }));
    await jest.advanceTimersByTimeAsync(0);
  });
const setAppState = (s: string) =>
  act(async () => {
    appListeners.forEach((l) => l(s));
    await jest.advanceTimersByTimeAsync(0);
  });
/** Advances fake time, running timers and the promise work they start. */
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

const START = new Date('2026-11-15T12:00:00.000Z');

beforeEach(() => {
  jest.useFakeTimers({ now: START });
  netListeners.clear();
  appListeners.clear();
  (NetInfo.addEventListener as jest.Mock).mockImplementation((l: NetListener) => {
    netListeners.add(l);
    l({ isConnected: true }); // NetInfo reports the current state on subscribe
    return () => netListeners.delete(l);
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, h: (s: string) => void) => {
    appListeners.add(h);
    return { remove: () => appListeners.delete(h) };
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function setup() {
  const repo = createMemoryRepo();
  const store = new CollectionStore(repo);
  const server = new FakeSyncRemote();
  return { repo, store, server };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function SessionProbe() {
  const { engine } = useSyncSession();
  return <Text>{engine ? 'engine: yes' : 'engine: no'}</Text>;
}

function SyncTree({
  repo,
  store,
  server,
  auth = testAuth,
  children = <SyncStatusLine />,
}: {
  repo: CollectionRepo;
  store: CollectionStore;
  server: FakeSyncRemote;
  auth?: AuthState;
  children?: ReactNode;
}) {
  return (
    <TestProviders store={store} auth={auth}>
      <SyncSessionProvider repo={repo} remote={server}>
        {children}
        <SessionProbe />
      </SyncSessionProvider>
    </TestProviders>
  );
}

async function renderSync(env: ReturnType<typeof setup>, auth: AuthState = testAuth) {
  const view = await render(<SyncTree {...env} auth={auth} />);
  await advance(0);
  return view;
}

describe('sync triggers', () => {
  it('syncs on sign-in, recording the user as the local owner', async () => {
    const env = setup();
    env.store.track('fx');
    const view = await renderSync(env, signedOutState);
    expect(env.server.pullCalls).toHaveLength(0);
    expect(screen.getByText('engine: no')).toBeOnTheScreen();

    await view.rerender(<SyncTree {...env} auth={testAuth} />);
    await advance(0);
    expect(env.server.pullCalls).toHaveLength(1);
    expect(env.server.snapshot().tracked.map((t) => t.setId)).toEqual(['fx']);
    expect(env.repo.getLocalOwner()).toBe('user-1');
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();
  });

  it('syncs 2 s after the last local write', async () => {
    const env = setup();
    await renderSync(env);
    expect(env.server.pullCalls).toHaveLength(1);

    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    await advance(1000);
    await act(async () => env.store.tap('fx', 'c-002', 'normal'));
    await advance(1999);
    expect(env.server.pushCalls).toHaveLength(0);
    await advance(1);
    expect(env.server.pushCalls).toHaveLength(1);
    expect(env.server.pushCalls[0]?.collection.map((r) => r.cardId).sort()).toEqual(['c-001', 'c-002']);
  });

  it('does not schedule a sync for remote changes a pull applied', async () => {
    const env = setup();
    await env.server.push({
      collection: [{ cardId: 'c-001', kind: 'normal', setId: 'fx', count: 2, updatedAt: '2026-11-15T11:00:00.000Z' }],
      tracked: [],
    });
    await renderSync(env);
    expect(env.repo.countsForSet('fx')).toEqual({ 'c-001:normal': 2 });
    await advance(5000);
    expect(env.server.pullCalls).toHaveLength(1);
  });

  it('syncs when the network comes back after being offline', async () => {
    const env = setup();
    await renderSync(env);
    await setNetwork(false);
    expect(screen.getByText("Offline — changes will sync when you're back online")).toBeOnTheScreen();
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    await advance(2000);
    expect(env.server.pushCalls).toHaveLength(0);

    await setNetwork(true);
    expect(env.server.pullCalls).toHaveLength(2);
    expect(env.server.pushCalls).toHaveLength(1);
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();
  });

  it('syncs when the app returns to the foreground', async () => {
    const env = setup();
    await renderSync(env);
    await setAppState('background');
    expect(env.server.pullCalls).toHaveLength(1);
    await setAppState('active');
    expect(env.server.pullCalls).toHaveLength(2);
  });

  it('syncs every 15 min while foregrounded, and not in the background', async () => {
    const env = setup();
    await renderSync(env);
    await advance(15 * 60_000);
    expect(env.server.pullCalls).toHaveLength(2);
    await setAppState('background');
    await advance(30 * 60_000);
    expect(env.server.pullCalls).toHaveLength(2);
  });

  it('retries a failed sync after 30 s, then 2 min, then every 10 min, resetting on success', async () => {
    const env = setup();
    const fail = () => env.server.failNext('pull', new Error('pull_changes: permission denied'));
    fail();
    await renderSync(env);
    expect(screen.getByText("Couldn't sync — will retry")).toBeOnTheScreen();
    expect(env.server.pullCalls).toHaveLength(1);

    fail();
    await advance(29_999);
    expect(env.server.pullCalls).toHaveLength(1);
    await advance(1);
    expect(env.server.pullCalls).toHaveLength(2);

    fail();
    await advance(2 * 60_000 - 1);
    expect(env.server.pullCalls).toHaveLength(2);
    await advance(1);
    expect(env.server.pullCalls).toHaveLength(3);

    fail();
    await advance(10 * 60_000);
    expect(env.server.pullCalls).toHaveLength(4);
    await advance(10 * 60_000); // capped at 10 min; this one succeeds
    expect(env.server.pullCalls).toHaveLength(5);
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();

    // Success reset the backoff: the next failure retries after 30 s again.
    fail();
    await setAppState('background');
    await setAppState('active');
    expect(env.server.pullCalls).toHaveLength(6);
    await advance(30_000);
    expect(env.server.pullCalls).toHaveLength(7);
  });

  it('waits for the network instead of retrying on a timer while offline', async () => {
    const env = setup();
    env.server.failNext('pull', new TypeError('Network request failed'));
    await renderSync(env);
    expect(screen.getByText("Offline — changes will sync when you're back online")).toBeOnTheScreen();
    await advance(15 * 60_000 - 1);
    expect(env.server.pullCalls).toHaveLength(1);
  });

  it('stops the engine on sign-out and exposes stop() for the sign-out flow', async () => {
    const env = setup();
    let session!: ReturnType<typeof useSyncSession>;
    function Grab() {
      session = useSyncSession();
      return null;
    }
    const view = await render(
      <SyncTree {...env}>
        <Grab />
      </SyncTree>,
    );
    await advance(0);
    const engine = session.engine!;
    expect(engine).not.toBeNull();
    await act(() => session.stop());
    // Stopped for good: later writes don't sync.
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    await advance(2000);
    expect(env.server.pushCalls).toHaveLength(0);

    await view.rerender(
      <SyncTree {...env} auth={signedOutState}>
        <Grab />
      </SyncTree>,
    );
    await advance(0);
    expect(session.engine).toBeNull();
  });

  it('waits for the previous engine to stop before a new session starts', async () => {
    const env = setup();
    const view = await renderSync(env);
    const gate = deferred();
    env.server.beforePull = () => gate.promise;
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    await advance(2000); // a run is now blocked in pull
    expect(env.server.pullCalls).toHaveLength(2);

    await view.rerender(<SyncTree {...env} auth={signedOutState} />);
    await view.rerender(<SyncTree {...env} auth={testAuth} />);
    await advance(0);
    expect(screen.getByText('engine: no')).toBeOnTheScreen();
    expect(env.server.pullCalls).toHaveLength(2);

    env.server.beforePull = undefined;
    await act(async () => gate.resolve());
    await advance(0);
    expect(screen.getByText('engine: yes')).toBeOnTheScreen();
    expect(env.server.pullCalls).toHaveLength(3);
  });

  it("wipes another account's local data before syncing as the new user", async () => {
    const env = setup();
    env.repo.setLocalOwner('someone-else');
    env.store.track('fx');
    await renderSync(env);
    expect(env.store.getTracked()).toEqual([]);
    expect(env.repo.getLocalOwner()).toBe('user-1');
    expect(env.server.snapshot().tracked).toEqual([]);
    expect(env.server.pullCalls).toHaveLength(1);
    expect(screen.getByText('engine: yes')).toBeOnTheScreen();
  });

  it('keeps the 15 min timer going when the foreground sync joins a run started in the background', async () => {
    const env = setup();
    await renderSync(env);
    await setAppState('background');
    const gate = deferred();
    env.server.beforePull = () => gate.promise;
    await setNetwork(false);
    await setNetwork(true); // starts a run while backgrounded; it blocks in pull
    expect(env.server.pullCalls).toHaveLength(2);
    await setAppState('active'); // joins the blocked run
    env.server.beforePull = undefined;
    await act(async () => gate.resolve());
    await advance(0);
    const pulls = env.server.pullCalls.length;
    await advance(15 * 60_000);
    expect(env.server.pullCalls.length).toBe(pulls + 1);
    await advance(15 * 60_000);
    expect(env.server.pullCalls.length).toBe(pulls + 2);
  });

  it('re-arms the 15 min timer on foreground, counted from then', async () => {
    const env = setup();
    await renderSync(env);
    await advance(10 * 60_000);
    await setAppState('background');
    await advance(10 * 60_000);
    await setAppState('active'); // syncs now, and the next periodic run is 15 min from here
    expect(env.server.pullCalls).toHaveLength(2);
    await advance(15 * 60_000 - 1);
    expect(env.server.pullCalls).toHaveLength(2);
    await advance(1);
    expect(env.server.pullCalls).toHaveLength(3);
  });

  it('releases the NetInfo and AppState listeners and any retry timer when the session ends', async () => {
    const env = setup();
    env.server.failNext('pull', new Error('pull_changes: permission denied'));
    const view = await renderSync(env);
    expect(netListeners.size).toBe(1);
    expect(appListeners.size).toBe(1);
    expect(jest.getTimerCount()).toBeGreaterThan(0); // the 30 s retry and the status line tick
    await view.rerender(<SyncTree {...env} auth={signedOutState} />);
    await advance(0);
    expect(netListeners.size).toBe(0);
    expect(appListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    await advance(60 * 60_000);
    expect(env.server.pullCalls).toHaveLength(1);
  });
});

describe('SyncStatusLine', () => {
  it('shows Syncing… while a run is in flight', async () => {
    const env = setup();
    const gate = deferred();
    env.server.beforePull = () => gate.promise;
    await renderSync(env);
    expect(screen.getByText('Syncing…')).toBeOnTheScreen();
    await act(async () => gate.resolve());
    await advance(0);
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();
  });

  it('ages the synced time every minute', async () => {
    const env = setup();
    await renderSync(env);
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();
    await advance(5 * 60_000);
    expect(screen.getByText('Synced 5 min ago')).toBeOnTheScreen();
    await setNetwork(false);
    await setNetwork(true); // reconnecting syncs, refreshing the time
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();
  });

  it('appends a live count of unsynced changes', async () => {
    const env = setup();
    await renderSync(env);
    await act(async () => env.store.tap('fx', 'c-001', 'normal'));
    expect(screen.getByText('Synced just now · 1 to sync')).toBeOnTheScreen();
    await act(async () => env.store.tap('fx', 'c-002', 'normal'));
    expect(screen.getByText('Synced just now · 2 to sync')).toBeOnTheScreen();
    await advance(2000);
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();
  });

  it('shows the status under the My Sets title', async () => {
    const env = setup();
    await render(
      <SyncTree {...env}>
        <HomeScreen />
      </SyncTree>,
    );
    await advance(0);
    expect(screen.getByText('My Sets')).toBeOnTheScreen();
    expect(screen.getByText('Synced just now')).toBeOnTheScreen();
  });

  it('announces the status only when its state changes, not as the time ages', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const env = setup();
    await renderSync(env);
    const line = screen.getByText('Synced just now');
    expect(line.props.accessibilityLiveRegion).toBeUndefined();
    announce.mockClear();
    await advance(5 * 60_000);
    expect(screen.getByText('Synced 5 min ago')).toBeOnTheScreen();
    expect(announce).not.toHaveBeenCalled();
    await setNetwork(false);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Offline — changes will sync when you're back online");
    await advance(5 * 60_000);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a sync session', async () => {
    await render(
      <TestProviders>
        <SyncStatusLine />
      </TestProviders>,
    );
    expect(screen.queryAllByText(/.+/)).toHaveLength(0);
  });
});

describe('formatSyncedAgo', () => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it.each([
    [0, 'just now'],
    [59_999, 'just now'],
    [-5_000, 'just now'],
    [60_000, '1 min ago'],
    [5 * 60_000, '5 min ago'],
    [59 * 60_000 + 59_000, '59 min ago'],
    [60 * 60_000, '1 h ago'],
    [2 * 3_600_000 + 5 * 60_000, '2 h ago'],
    [23 * 3_600_000 + 59 * 60_000, '23 h ago'],
  ])('%d ms ago reads "%s"', (ms, text) => {
    expect(formatSyncedAgo(ago(ms), now)).toBe(text);
  });

  it('uses a short date after a day', () => {
    const d = new Date(2026, 10, 14, 9, 30);
    expect(formatSyncedAgo(d.toISOString(), d.getTime() + 25 * 3_600_000)).toBe('Nov 14');
  });
});

describe('prices', () => {
  const HOUR = 3_600_000;

  async function renderSet(cache: PriceCache, fetchPrices: (setId: string) => Promise<Record<string, number>>, enabled = true) {
    const store = new CollectionStore(createMemoryRepo());
    store.track('fx');
    store.setCount('fx', 'c-001', 'normal', 2);
    const view = await render(
      <TestProviders store={store}>
        <RefreshingPriceProvider cache={cache} fetchPrices={fetchPrices} enabled={enabled}>
          <SetScreen />
        </RefreshingPriceProvider>
      </TestProviders>,
    );
    await advance(0);
    return { store, view };
  }

  it('fetches prices for tracked sets with no cache and shows the value line', async () => {
    const cache = createMemoryPriceCache();
    const fetchPrices = jest.fn(async () => ({ 'c-001|normal': 5.75, 'c-004|holofoil': 1 }));
    await renderSet(cache, fetchPrices);
    expect(fetchPrices).toHaveBeenCalledWith('fx');
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    expect(cache.get('fx')).toEqual({ fetchedAt: START.toISOString(), prices: { 'c-001|normal': 5.75, 'c-004|holofoil': 1 } });
    expect(screen.getByText(/Owned \$11\.50 · To finish ≈ \$1\.00/)).toBeOnTheScreen();
  });

  it('skips the fetch when the cache is under 12 h old, showing cached prices', async () => {
    const cache = createMemoryPriceCache();
    cache.put('fx', new Date(START.getTime() - 11 * HOUR).toISOString(), { 'c-001|normal': 3 });
    const fetchPrices = jest.fn(async () => ({}));
    await renderSet(cache, fetchPrices);
    expect(fetchPrices).not.toHaveBeenCalled();
    expect(screen.getByText(/Owned \$6\.00/)).toBeOnTheScreen();
  });

  it('refetches a cache older than 12 h', async () => {
    const cache = createMemoryPriceCache();
    cache.put('fx', new Date(START.getTime() - 13 * HOUR).toISOString(), { 'c-001|normal': 3 });
    const fetchPrices = jest.fn(async () => ({ 'c-001|normal': 4 }));
    await renderSet(cache, fetchPrices);
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Owned \$8\.00/)).toBeOnTheScreen();
  });

  it('keeps the old cache when a fetch fails and retries at the next trigger', async () => {
    const cache = createMemoryPriceCache();
    cache.put('fx', new Date(START.getTime() - 13 * HOUR).toISOString(), { 'c-001|normal': 3 });
    const fetchPrices = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ 'c-001|normal': 4 });
    await renderSet(cache, fetchPrices);
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Owned \$6\.00/)).toBeOnTheScreen();
    await setAppState('background');
    await setAppState('active');
    expect(fetchPrices).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Owned \$8\.00/)).toBeOnTheScreen();
  });

  it('survives a fetch that throws synchronously, and retries that set at the next check', async () => {
    const cache = createMemoryPriceCache();
    const fetchPrices = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('not configured');
      })
      .mockResolvedValue({ 'c-001|normal': 4 });
    await renderSet(cache, fetchPrices);
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 of 11 collected/)).toBeOnTheScreen(); // the screen survived
    await setAppState('background');
    await setAppState('active');
    expect(fetchPrices).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Owned \$8\.00/)).toBeOnTheScreen();
  });

  it('survives a cache write that throws, without an unhandled rejection, and retries', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const cache = createMemoryPriceCache();
      const put = jest.spyOn(cache, 'put').mockImplementationOnce(() => {
        throw new Error('database is locked');
      });
      const fetchPrices = jest.fn(async () => ({ 'c-001|normal': 4 }));
      await renderSet(cache, fetchPrices);
      await advance(0);
      expect(put).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
      await setAppState('background');
      await setAppState('active');
      expect(fetchPrices).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Owned \$8\.00/)).toBeOnTheScreen();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('does not fetch while offline, and fetches when back online', async () => {
    (NetInfo.addEventListener as jest.Mock).mockImplementation((l: NetListener) => {
      netListeners.add(l);
      l({ isConnected: false });
      return () => netListeners.delete(l);
    });
    const cache = createMemoryPriceCache();
    const fetchPrices = jest.fn(async () => ({ 'c-001|normal': 4 }));
    await renderSet(cache, fetchPrices);
    expect(fetchPrices).not.toHaveBeenCalled();
    await setNetwork(true);
    expect(fetchPrices).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled (signed out)', async () => {
    const cache = createMemoryPriceCache();
    const fetchPrices = jest.fn(async () => ({}));
    await renderSet(cache, fetchPrices, false);
    expect(fetchPrices).not.toHaveBeenCalled();
  });

  it('fetches a newly tracked set', async () => {
    const cache = createMemoryPriceCache();
    cache.put('fx', START.toISOString(), {});
    const fetchPrices = jest.fn(async () => ({}));
    const { store } = await renderSet(cache, fetchPrices);
    expect(fetchPrices).not.toHaveBeenCalled();
    await act(async () => store.track('other'));
    await advance(0);
    expect(fetchPrices).toHaveBeenCalledWith('other');
  });
});
