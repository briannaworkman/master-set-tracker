import { emptyPriceBook } from '@mst/collection-core';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { bundledCatalog } from '../src/catalog/bundled';
import { CatalogProvider, createCatalog } from '../src/catalog/CatalogContext';
import { PersistenceContext } from '../src/components/WebPreviewNote';
import { getAppStore } from '../src/db/openStore';
import { StoreProvider } from '../src/db/StoreContext';
import { PriceProvider } from '../src/prices/PriceContext';
import { useTheme } from '../src/theme/useTheme';

const catalog = createCatalog(bundledCatalog, { includeDrafts: __DEV__ });

export default function RootLayout() {
  const { store, persistent } = getAppStore();
  const theme = useTheme();
  return (
    <SafeAreaProvider>
      <CatalogProvider catalog={catalog}>
        <StoreProvider store={store}>
          <PriceProvider priceBook={emptyPriceBook}>
            <PersistenceContext.Provider value={persistent}>
              <StatusBar style="auto" />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: theme.bg },
                  headerTintColor: theme.text,
                  headerShadowVisible: false,
                  contentStyle: { backgroundColor: theme.bg },
                }}
              >
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="browse" options={{ title: 'Add a set' }} />
              </Stack>
            </PersistenceContext.Provider>
          </PriceProvider>
        </StoreProvider>
      </CatalogProvider>
    </SafeAreaProvider>
  );
}
