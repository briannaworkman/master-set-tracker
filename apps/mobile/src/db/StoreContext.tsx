import type { CollectionStore, Counts, TrackedSet } from '@mst/collection-core';
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';

const StoreContext = createContext<CollectionStore | null>(null);

export function StoreProvider({ store, children }: { store: CollectionStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): CollectionStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside a StoreProvider');
  return store;
}

export function useTracked(): TrackedSet[] {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getTracked, store.getTracked);
}

export function useCounts(setId: string): Counts {
  const store = useStore();
  const get = useCallback(() => store.getCounts(setId), [store, setId]);
  return useSyncExternalStore(store.subscribe, get, get);
}
