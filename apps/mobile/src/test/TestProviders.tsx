import { CollectionStore, createMemoryRepo, emptyPriceBook, type PriceBook } from '@mst/collection-core';
import { fixtureCatalog, fixtureKinds } from '@mst/collection-core/testing';
import { useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthStateContext, type AuthState } from '../auth/AuthProvider';
import { CatalogProvider, createCatalog } from '../catalog/CatalogContext';
import { StoreProvider } from '../db/StoreContext';
import { PriceProvider } from '../prices/PriceContext';

const { id, name, series, releaseDate, logoUrl, catalogVersion, versionCount } = fixtureCatalog;

/** The Task 1 fixture set ("fx"), published. */
export const testCatalog = createCatalog(
  {
    index: {
      generatedAt: '2026-11-15T00:00:00.000Z',
      kinds: fixtureKinds,
      sets: [{ id, name, series, releaseDate, logoUrl, catalogVersion, versionCount }],
    },
    sets: { [id]: fixtureCatalog },
  },
  { includeDrafts: false },
);

/** Default test auth: signed in as a fake user. */
export const testAuth: AuthState = { status: 'signedIn', userId: 'user-1', email: 'test@example.com', provider: 'email' };

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** App providers for tests: fixture catalog, a store over a fresh memory repo, and a price book. */
export function TestProviders({
  children,
  store,
  priceBook = emptyPriceBook,
  auth = testAuth,
}: {
  children: ReactNode;
  store?: CollectionStore;
  priceBook?: PriceBook;
  auth?: AuthState;
}) {
  const [ownStore] = useState(() => store ?? new CollectionStore(createMemoryRepo()));
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <AuthStateContext.Provider value={auth}>
      <CatalogProvider catalog={testCatalog}>
        <StoreProvider store={store ?? ownStore}>
          <PriceProvider priceBook={priceBook}>{children}</PriceProvider>
        </StoreProvider>
      </CatalogProvider>
      </AuthStateContext.Provider>
    </SafeAreaProvider>
  );
}
