import { SyncEngine, type CollectionRepo, type SyncRemote, type SyncStatus } from '@mst/collection-core';
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
  if (!ctx) throw new Error(`${hook} must be used inside a SyncProvider`);
  return ctx;
}

/**
 * Runs `engine` for the signed-in session: syncs on mount (sign-in), on foreground, when the
 * network comes back, 2 s after the last local write, and every 15 min while foregrounded
 * (counted from the last run). A run that ends in 'error' is retried after 30 s, 2 min, then
 * every 10 min until one succeeds; 'offline' waits for the network to come back instead.
 * Status listeners only schedule timers: syncNow is never called from inside one.
 */
export function SyncProvider({ engine, repo, children }: { engine: SyncEngine; repo: CollectionRepo; children: ReactNode }) {
  const value = useMemo(() => ({ engine, repo }), [engine, repo]);
  return (
    <SyncContext.Provider value={value}>
      <SyncTriggers engine={engine} repo={repo} />
      {children}
    </SyncContext.Provider>
  );
}

/** The triggers and retry policy of SyncProvider, without the context (renders nothing). */
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

    const triggers = watchAppTriggers({
      onForeground: run,
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
        periodicTimer = cancel(periodicTimer);
        if (triggers.isForeground()) periodicTimer = later(PERIODIC_MS);
      } else if (s.state === 'error') {
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

/** True when there is a SyncProvider above (a signed-in session whose engine is running). */
export function useHasSync(): boolean {
  return useContext(SyncContext) !== null;
}

export interface SyncSession {
  /** The current session's engine, or null (signed out, starting, or local data owned by another user). */
  engine: SyncEngine | null;
  /**
   * Stops the current engine for good and resolves once nothing more will be written; resolves
   * at once if none is running. Await this before wiping the store (sign-out).
   */
  stop(): Promise<void>;
  /** The signed-in user differs from the local data's owner, so sync is held back (sign-out wipes it). */
  ownerMismatch: boolean;
}

const SyncSessionContext = createContext<SyncSession>({
  engine: null,
  stop: () => Promise.resolve(),
  ownerMismatch: false,
});

export function useSyncSession(): SyncSession {
  return useContext(SyncSessionContext);
}

/**
 * One SyncEngine per signed-in session. When the user signs in, waits for the previous engine
 * (if any) to finish stopping, checks the local owner (adopting unowned local data, holding sync
 * back if another user owns it), then creates the engine. On sign-out or a user change the
 * engine is stopped.
 */
export function SyncSessionProvider({ repo, remote, children }: { repo: CollectionRepo; remote: SyncRemote; children: ReactNode }) {
  const store = useStore();
  const { status, userId } = useAuth();
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [ownerMismatch, setOwnerMismatch] = useState(false);
  const engineRef = useRef<SyncEngine | null>(null);
  const lastStop = useRef<Promise<void>>(Promise.resolve());

  const stop = useCallback(() => {
    const current = engineRef.current;
    if (current) lastStop.current = current.stop();
    return lastStop.current;
  }, []);

  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    let cancelled = false;
    let created: SyncEngine | null = null;
    void lastStop.current.then(() => {
      if (cancelled) return;
      const owner = repo.getLocalOwner();
      if (owner !== null && owner !== userId) {
        console.warn('Local data belongs to a different account; sync is paused until it is cleared.');
        setOwnerMismatch(true);
        return;
      }
      if (owner === null) repo.setLocalOwner(userId);
      created = new SyncEngine({ repo, store, remote });
      engineRef.current = created;
      setEngine(created);
    });
    return () => {
      cancelled = true;
      if (created) {
        lastStop.current = created.stop();
        if (engineRef.current === created) engineRef.current = null;
      }
      setEngine(null);
      setOwnerMismatch(false);
    };
  }, [status, userId, repo, store, remote]);

  const session = useMemo(() => ({ engine, stop, ownerMismatch }), [engine, stop, ownerMismatch]);
  const sync = useMemo(() => (engine ? { engine, repo } : null), [engine, repo]);
  // A fixed tree shape, so the app below doesn't remount when the engine comes and goes.
  return (
    <SyncSessionContext.Provider value={session}>
      <SyncContext.Provider value={sync}>
        {engine ? <SyncTriggers engine={engine} repo={repo} /> : null}
        {children}
      </SyncContext.Provider>
    </SyncSessionContext.Provider>
  );
}
