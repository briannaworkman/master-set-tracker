import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { bundledCatalog } from '../src/catalog/bundled';
import { CatalogProvider, createCatalog } from '../src/catalog/CatalogContext';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { getSupabase } from '../src/backend/supabase';
import { createSupabaseRemote, fetchSetPrices } from '../src/backend/supabase-remote';
import { PersistenceContext } from '../src/components/WebPreviewNote';
import { getAppStore, type OpenedStore } from '../src/db/openStore';
import { StoreProvider } from '../src/db/StoreContext';
import { RefreshingPriceProvider } from '../src/prices/PriceContext';
import { SyncSessionProvider } from '../src/sync/SyncProvider';
import { useTheme, type Theme } from '../src/theme/useTheme';

SplashScreen.preventAutoHideAsync().catch(() => {});

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

const fetchPrices = (setId: string) => fetchSetPrices(getSupabase(), setId);

/** Cached prices for the tracked sets, refreshed while signed in (card_prices needs a session). */
function AppPrices({ cache, children }: { cache: OpenedStore['priceCache']; children: ReactNode }) {
  const { status, userId } = useAuth();
  return (
    <RefreshingPriceProvider cache={cache} fetchPrices={fetchPrices} enabled={status === 'signedIn' && userId !== null}>
      {children}
    </RefreshingPriceProvider>
  );
}

/** Signed out: only the sign-in routes exist, so deep links to app routes land on sign-in. */
function AuthGate({ theme }: { theme: Theme }) {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [status]);
  if (status === 'loading') return <View style={[styles.splash, { backgroundColor: theme.bg }]} />;
  const signedIn = status === 'signedIn';
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Protected guard={signedIn}>
        {/* The title is never shown here, but iOS uses it as the back-button label. */}
        <Stack.Screen name="index" options={{ title: 'My Sets', headerShown: false }} />
        <Stack.Screen name="browse" options={{ title: 'Add a set' }} />
        {/* Every app route must be declared here: undeclared routes are not guarded. */}
        <Stack.Screen name="set/[id]/index" />
        <Stack.Screen name="set/[id]/settings" />
        <Stack.Screen name="set/[id]/card/[cardId]" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in-email" options={{ title: '' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [opened] = useState(openOnce);
  const [remote] = useState(() => createSupabaseRemote(getSupabase()));
  const theme = useTheme();
  if ('error' in opened) return <StoreError error={opened.error} theme={theme} />;
  const { store, repo, priceCache, persistent } = opened.ok;
  return (
    <SafeAreaProvider>
      <AuthProvider client={getSupabase()}>
        <CatalogProvider catalog={catalog}>
          <StoreProvider store={store}>
            <SyncSessionProvider repo={repo} remote={remote}>
              <AppPrices cache={priceCache}>
                <PersistenceContext.Provider value={persistent}>
                  <StatusBar style="auto" />
                  <AuthGate theme={theme} />
                </PersistenceContext.Provider>
              </AppPrices>
            </SyncSessionProvider>
          </StoreProvider>
        </CatalogProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1 },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  errorTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorDetail: { fontSize: 13, textAlign: 'center' },
});
