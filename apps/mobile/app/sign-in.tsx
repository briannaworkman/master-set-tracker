import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { googleAvailable, loadApple, signInWithApple, signInWithGoogle } from '../src/auth/providers';
import { getSupabase } from '../src/backend/supabase';
import { useTheme } from '../src/theme/useTheme';

export const SIGN_IN_ERROR = "Couldn't sign in. Check your connection and try again.";

export default function SignInScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const [appleOk, setAppleOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let live = true;
    loadApple()
      .isAvailableAsync()
      .then((ok) => live && setAppleOk(ok))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const run = async (fn: (client: ReturnType<typeof getSupabase>) => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn(getSupabase());
    } catch {
      setError(SIGN_IN_ERROR);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const Apple = appleOk ? loadApple() : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Master Set Tracker
        </Text>
        <Text style={[styles.tagline, { color: theme.muted }]}>Track every version of every card.</Text>
      </View>
      <View style={styles.actions}>
        {Apple ? (
          <Apple.AppleAuthenticationButton
            buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              scheme === 'dark'
                ? Apple.AppleAuthenticationButtonStyle.WHITE
                : Apple.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={10}
            style={styles.apple}
            onPress={() => run(signInWithApple)}
          />
        ) : null}
        {googleAvailable() ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => run(signInWithGoogle)}
            style={[styles.button, { borderColor: theme.border, backgroundColor: theme.surface }]}
          >
            <Text style={[styles.buttonText, { color: theme.text }]}>Continue with Google</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue with email"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => router.push('/sign-in-email')}
          style={[styles.button, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.buttonText, { color: theme.text }]}>Continue with email</Text>
        </Pressable>
        {busy ? <ActivityIndicator accessibilityLabel="Signing in" color={theme.muted} /> : null}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.footer, { color: theme.muted }]}>
        Your marks are saved to your account so they're safe on every device.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, justifyContent: 'space-between' },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  title: { fontSize: 30, fontWeight: '700', textAlign: 'center' },
  tagline: { fontSize: 16, textAlign: 'center' },
  actions: { gap: 12, paddingBottom: 16 },
  apple: { width: '100%', height: 50 },
  button: {
    height: 50,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 17, fontWeight: '600' },
  error: { fontSize: 14, textAlign: 'center' },
  footer: { fontSize: 13, textAlign: 'center', paddingBottom: 16 },
});
