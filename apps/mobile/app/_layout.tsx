import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { bundledCatalog } from '../src/catalog/bundled';
import { CatalogProvider, createCatalog } from '../src/catalog/CatalogContext';
import { endAuthSession } from '../src/account/flows';
import { AuthProvider } from '../src/auth/AuthProvider';
import { getSupabase } from '../src/backend/supabase';
import { createSupabaseRemote, fetchSetPrices } from '../src/backend/supabase-remote';
import { PersistenceContext } from '../src/components/WebPreviewNote';
import { getAppStore, type OpenedStore } from '../src/db/openStore';
import { StoreProvider } from '../src/db/StoreContext';
import { SessionPriceProvider } from '../src/prices/PriceContext';
import { SyncSessionProvider, useSessionGate } from '../src/sync/SyncProvider';
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

/** The signed-in user's local data couldn't be checked or cleared, so it isn't shown. */
function SessionError({ theme }: { theme: Theme }) {
  return (
    <View style={[styles.error, { backgroundColor: theme.bg }]}>
      <StatusBar style="auto" />
      <Text accessibilityRole="header" style={[styles.errorTitle, { color: theme.text }]}>
        Couldn't open your collection
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void endAuthSession(getSupabase(), 'local')}
        style={[styles.errorButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
      >
        <Text style={[styles.errorButtonText, { color: theme.text }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

/**
 * Signed out: only the sign-in routes exist, so deep links to app routes land on sign-in. Signed
 * in: the app routes exist only once the local data has been checked for this user (another
 * account's data is wiped first), so nobody ever sees someone else's marks.
 */
function AuthGate({ theme }: { theme: Theme }) {
  const gate = useSessionGate();
  useEffect(() => {
    if (gate !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [gate]);
  if (gate === 'loading') return <View style={[styles.splash, { backgroundColor: theme.bg }]} />;
  if (gate === 'failed') return <SessionError theme={theme} />;
  const signedIn = gate === 'signedIn';
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
        <Stack.Screen name="account" options={{ title: 'Account' }} />
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
            <SyncSessionProvider repo={repo} remote={remote} priceCache={priceCache}>
              <SessionPriceProvider cache={priceCache} fetchPrices={fetchPrices}>
                <PersistenceContext.Provider value={persistent}>
                  <StatusBar style="auto" />
                  <AuthGate theme={theme} />
                </PersistenceContext.Provider>
              </SessionPriceProvider>
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
  errorButton: {
    minHeight: 44,
    paddingHorizontal: 24,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorButtonText: { fontSize: 16, fontWeight: '600' },
});
