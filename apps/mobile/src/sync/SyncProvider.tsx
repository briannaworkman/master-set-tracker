import { SyncEngine, type CollectionRepo, type PriceCache, type SyncRemote, type SyncStatus } from '@mst/collection-core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useStore } from '../db/StoreContext';
import { PERIODIC_MS, watchAppTriggers } from './appTriggers';

/** A local write is pushed this long after the last one in a burst. */
export const WRITE_DEBOUNCE_MS = 2000;
/** Retry delays after consecutive failed runs; the last one repeats. */
export const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];

interface SyncContextValue {
  engine: SyncEngine;
  repo: CollectionRepo;
}

const SyncContext = createContext<SyncContextValue | null>(null);

function useSyncContext(hook: string): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error(`${hook} must be used inside a running sync session`);
  return ctx;
}

/**
 * Runs `engine` for the signed-in session (renders nothing): syncs on mount (sign-in), on
 * foreground, when the network comes back, 2 s after the last local write, and every 15 min while
 * foregrounded (counted from the end of the last run or the last foreground, re-armed after every
 * run so it can't silently stop). A run that ends in 'error' is retried after 30 s, 2 min, then
 * every 10 min until one succeeds; 'offline' waits for the network to come back instead. Status
 * listeners only schedule timers: syncNow is never called from inside one. Unmounting releases
 * every listener and timer.
 */
function SyncTriggers({ engine, repo }: { engine: SyncEngine; repo: CollectionRepo }) {
  const store = useStore();

  useEffect(() => {
    let disposed = false;
    const run = () => {
      if (!disposed) void engine.syncNow();
    };
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        run();
      }, ms);
      timers.add(t);
      return t;
    };
    const cancel = (t: ReturnType<typeof setTimeout> | null) => {
      if (t === null) return null;
      clearTimeout(t);
      timers.delete(t);
      return null;
    };

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let periodicTimer: ReturnType<typeof setTimeout> | null = null;
    let writeTimer: ReturnType<typeof setTimeout> | null = null;

    const armPeriodic = () => {
      periodicTimer = cancel(periodicTimer);
      if (triggers.isForeground()) periodicTimer = later(PERIODIC_MS);
    };

    const triggers = watchAppTriggers({
      onForeground: () => {
        armPeriodic();
        run();
      },
      onBackground: () => {
        periodicTimer = cancel(periodicTimer);
      },
      onOnlineChange: (online) => {
        engine.setOnline(online);
        if (online) run();
        else retryTimer = cancel(retryTimer);
      },
    });
    engine.setOnline(triggers.isOnline());

    let failures = 0;
    let { state: prevState, lastSyncedAt: prevSyncedAt } = engine.getStatus();
    const offStatus = engine.subscribe((s) => {
      if (s.lastSyncedAt !== prevSyncedAt) {
        prevSyncedAt = s.lastSyncedAt;
        failures = 0;
      }
      if (s.state === prevState) return;
      prevState = s.state;
      if (s.state === 'syncing') {
        retryTimer = cancel(retryTimer);
        return;
      }
      // A run ended (or the state changed without one): the next periodic run is 15 min from now.
      armPeriodic();
      if (s.state === 'error') {
        retryTimer = cancel(retryTimer);
        retryTimer = later(RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]!);
        failures += 1;
      } else if (s.state === 'offline') {
        retryTimer = cancel(retryTimer);
      }
    });

    // Only a local write leaves rows dirty; rows a pull applied are stored clean.
    const offStore = store.subscribe(() => {
      if (repo.dirtyCount() === 0) return;
      writeTimer = cancel(writeTimer);
      writeTimer = later(WRITE_DEBOUNCE_MS);
    });

    run(); // sign-in

    return () => {
      disposed = true;
      triggers.dispose();
      offStatus();
      offStore();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [engine, repo, store]);

  return null;
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useSyncContext('useSyncStatus');
  const subscribe = useCallback((cb: () => void) => engine.subscribe(cb), [engine]);
  const get = useCallback(() => engine.getStatus(), [engine]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Starts (or joins) a sync. Outside a sync session (signed out) it resolves at once. */
export function useSyncNow(): () => Promise<void> {
  const ctx = useContext(SyncContext);
  const engine = ctx?.engine;
  return useCallback(async () => {
    if (engine) await engine.syncNow();
  }, [engine]);
}

/**
 * Live count of local changes not yet pushed: re-read on every store write and every status
 * change (a push clears rows without a store event). status.pending lags writes, so use this.
 */
export function usePendingCount(): number {
  const { engine, repo } = useSyncContext('usePendingCount');
  const store = useStore();
  const subscribe = useCallback(
    (cb: () => void) => {
      const offStore = store.subscribe(cb);
      const offEngine = engine.subscribe(cb);
      return () => {
        offStore();
        offEngine();
      };
    },
    [store, engine],
  );
  const get = useCallback(() => repo.dirtyCount(), [repo]);
  return useSyncExternalStore(subscribe, get, get);
}

/** True inside a signed-in session whose engine exists (it may be stopping during sign-out). */
export function useHasSync(): boolean {
  return useContext(SyncContext) !== null;
}

/** How long sign-out waits for the engine to stop before wiping anyway (see endSession). */
export const STOP_TIMEOUT_MS = 15_000;

/** Resolves when `p` settles or after `ms`, whichever comes first; never rejects. */
export function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(t);
      resolve();
    };
    p.then(done, done);
  });
}

export interface SyncSession {
  /** The current session's engine, or null (signed out, or the local data is still being checked). */
  engine: SyncEngine | null;
  /**
   * Stops the current engine for good and resolves once nothing more will be written; resolves
   * at once if none is running.
   */
  stop(): Promise<void>;
  /**
   * The signed-in user's local data has been checked (and wiped if it was another account's), so
   * app screens may render. False while signed out and while the check is pending.
   */
  ready: boolean;
  /** The check (or the wipe it needed) failed: the local data must not be shown. */
  failed: boolean;
  /** Ready and not ending: price fetching may run. */
  pricesEnabled: boolean;
  /** Local changes not yet pushed (repo.dirtyCount()). */
  pendingCount(): number;
  /**
   * The sign-out / account-deletion step after any sync and confirmation: stops background sync
   * and price fetching, stops the engine (waiting at most STOP_TIMEOUT_MS: once stop() is called
   * the engine writes nothing more, so wiping after the timeout is still safe), then wipes local
   * collection, tracked sets, sync state (incl. owner) and the price cache. If the wipe throws, a
   * fresh engine is started (see restart) and the error is rethrown.
   */
  endSession(): Promise<void>;
  /** Starts a fresh engine and resumes price fetching for the still-signed-in user. */
  restart(): void;
}

const SyncSessionContext = createContext<SyncSession>({
  engine: null,
  stop: () => Promise.resolve(),
  ready: false,
  failed: false,
  pricesEnabled: false,
  pendingCount: () => 0,
  endSession: () => Promise.resolve(),
  restart: () => {},
});

export function useSyncSession(): SyncSession {
  return useContext(SyncSessionContext);
}

export type SessionGate = 'loading' | 'signedOut' | 'signedIn' | 'failed';

/**
 * What the app may show: 'signedIn' only once the signed-in user's local data has been checked,
 * so another account's marks are never on screen; 'loading' until then (and while the auth
 * session loads); 'failed' if that check failed.
 */
export function useSessionGate(): SessionGate {
  const { status } = useAuth();
  const { ready, failed } = useSyncSession();
  if (status === 'loading') return 'loading';
  if (status === 'signedOut') return 'signedOut';
  if (ready) return 'signedIn';
  return failed ? 'failed' : 'loading';
}

/** True when the local data was written by a different account (or by some earlier, unknown one). */
function belongsToSomeoneElse(repo: CollectionRepo, userId: string): boolean {
  const owner = repo.getLocalOwner();
  if (owner !== null) return owner !== userId;
  // Unowned: adopt it only if it has never synced (data from before accounts existed).
  const { cursor, lastSyncedAt } = repo.getSyncState();
  return cursor > 0 || lastSyncedAt !== null;
}

/**
 * One SyncEngine per signed-in session. When a user signs in it waits for the previous engine (if
 * any) to finish stopping, then checks the local data: another account's data (or unowned data
 * with sync history) is wiped, including the price cache, before `ready` turns true; unowned data
 * that never synced is adopted. Then it records the owner and creates the engine. On sign-out or a
 * user change the engine is stopped.
 */
export function SyncSessionProvider({
  repo,
  remote,
  priceCache,
  children,
}: {
  repo: CollectionRepo;
  remote: SyncRemote;
  /** Cleared with the local data (the SQLite repo's wipe covers its own table; a memory cache isn't). */
  priceCache?: PriceCache;
  children: ReactNode;
}) {
  const store = useStore();
  const { status, userId } = useAuth();
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  /** The user whose local data has been checked; null while signed out or checking. */
  const [checkedUser, setCheckedUser] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Set by endSession: background sync and price fetching are off until restart or sign-out. */
  const [closing, setClosing] = useState(false);
  /** Bumped by restart() to create a fresh engine for the same user. */
  const [generation, setGeneration] = useState(0);
  const engineRef = useRef<SyncEngine | null>(null);
  const lastStop = useRef<Promise<void>>(Promise.resolve());

  const stop = useCallback(() => {
    const current = engineRef.current;
    if (current) lastStop.current = current.stop();
    return lastStop.current;
  }, []);

  const wipeLocal = useCallback(() => {
    store.wipe();
    priceCache?.clear();
  }, [store, priceCache]);

  useEffect(() => {
    if (status !== 'signedIn' || !userId) {
      setCheckedUser(null);
      setFailed(false);
      setClosing(false);
      return;
    }
    let cancelled = false;
    let created: SyncEngine | null = null;
    // stop() halts every write at once, so the wait is capped: a hung request can't block sign-in.
    void settleWithin(lastStop.current, STOP_TIMEOUT_MS).then(() => {
      if (cancelled) return;
      try {
        if (belongsToSomeoneElse(repo, userId)) wipeLocal();
        if (repo.getLocalOwner() === null) repo.setLocalOwner(userId);
      } catch (e) {
        console.error("Could not clear the previous account's local data", e);
        setFailed(true);
        return;
      }
      created = new SyncEngine({ repo, store, remote });
      engineRef.current = created;
      setEngine(created);
      setCheckedUser(userId);
    });
    return () => {
      cancelled = true;
      if (created) {
        lastStop.current = created.stop();
        if (engineRef.current === created) engineRef.current = null;
      }
      setEngine(null);
      setFailed(false);
    };
  }, [status, userId, repo, store, remote, wipeLocal, generation]);

  const restart = useCallback(() => {
    setClosing(false);
    setGeneration((g) => g + 1);
  }, []);

  const endSession = useCallback(async () => {
    setClosing(true);
    await settleWithin(stop(), STOP_TIMEOUT_MS);
    try {
      wipeLocal();
    } catch (e) {
      console.error('Could not wipe local data', e);
      restart();
      throw e;
    }
  }, [stop, wipeLocal, restart]);

  const pendingCount = useCallback(() => repo.dirtyCount(), [repo]);

  const ready = status === 'signedIn' && userId !== null && checkedUser === userId;
  const session = useMemo<SyncSession>(
    () => ({
      engine,
      stop,
      ready,
      failed: failed && !ready,
      pricesEnabled: ready && !closing,
      pendingCount,
      endSession,
      restart,
    }),
    [engine, stop, ready, failed, closing, pendingCount, endSession, restart],
  );
  const sync = useMemo(() => (engine ? { engine, repo } : null), [engine, repo]);
  // A fixed tree shape, so the app below doesn't remount when the engine comes and goes.
  return (
    <SyncSessionContext.Provider value={session}>
      <SyncContext.Provider value={sync}>
        {engine && !closing ? <SyncTriggers engine={engine} repo={repo} /> : null}
        {children}
      </SyncContext.Provider>
    </SyncSessionContext.Provider>
  );
}
