import { emptyPriceBook } from '@mst/collection-core';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { bundledCatalog } from '../src/catalog/bundled';
import { CatalogProvider, createCatalog } from '../src/catalog/CatalogContext';
import { PersistenceContext } from '../src/components/WebPreviewNote';
import { getAppStore, type OpenedStore } from '../src/db/openStore';
import { StoreProvider } from '../src/db/StoreContext';
import { PriceProvider } from '../src/prices/PriceContext';
import { useTheme, type Theme } from '../src/theme/useTheme';

const catalog = createCatalog(bundledCatalog, { includeDrafts: __DEV__ });

type OpenResult = { ok: OpenedStore } | { error: unknown };

function openOnce(): OpenResult {
  try {
    return { ok: getAppStore() };
  } catch (error) {
    console.error('Could not open the collection database', error);
    return { error };
  }
}

/** Shown instead of a blank crash when the on-device database can't be opened or migrated. */
function StoreError({ error, theme }: { error: unknown; theme: Theme }) {
  return (
    <View style={[styles.error, { backgroundColor: theme.bg }]}>
      <StatusBar style="auto" />
      <Text accessibilityRole="header" style={[styles.errorTitle, { color: theme.text }]}>
        Couldn't open your collection
      </Text>
      {__DEV__ ? (
        <Text selectable style={[styles.errorDetail, { color: theme.muted }]}>
          {error instanceof Error ? error.message : String(error)}
        </Text>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  const [opened] = useState(openOnce);
  const theme = useTheme();
  if ('error' in opened) return <StoreError error={opened.error} theme={theme} />;
  const { store, persistent } = opened.ok;
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
                {/* The title is never shown here, but iOS uses it as the back-button label. */}
                <Stack.Screen name="index" options={{ title: 'My Sets', headerShown: false }} />
                <Stack.Screen name="browse" options={{ title: 'Add a set' }} />
                <Stack.Screen name="set/[id]/card/[cardId]" options={{ presentation: 'modal' }} />
              </Stack>
            </PersistenceContext.Provider>
          </PriceProvider>
        </StoreProvider>
      </CatalogProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  errorTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorDetail: { fontSize: 13, textAlign: 'center' },
});
