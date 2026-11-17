import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InvalidCodeError, sendEmailCode, verifyEmailCode } from '../src/auth/providers';
import { backendConfig } from '../src/backend/config';
import { getSupabase } from '../src/backend/supabase';
import { useTheme } from '../src/theme/useTheme';

/** "an" before the number words that start with a vowel sound: 8, 11, 18. */
const articleFor = (n: number) => (n === 8 || n === 11 || n === 18 ? 'an' : 'a');

const RESEND_SECONDS = 60;
const WRONG_CODE = "That code didn't work. Check it and try again.";
const GENERIC_ERROR = "Couldn't sign in. Check your connection and try again.";
const SEND_ERROR = "Couldn't send the code. Check your connection and try again.";

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function SignInEmailScreen() {
  const codeLength = backendConfig.emailOtpLength;
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const resendIn = resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const counting = resendIn > 0;
  useEffect(() => {
    if (!counting) return;
    // The deadline is absolute, so a backgrounded app can't stretch the wait.
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [counting]);

  const guarded = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const normalised = email.trim().toLowerCase();
  const emailOk = isValidEmail(normalised);

  const send = (target: string) =>
    guarded(async () => {
      try {
        await sendEmailCode(getSupabase(), target);
        setSentTo(target);
        setCode('');
        const t = Date.now();
        setNow(t);
        setResendAt(t + RESEND_SECONDS * 1000);
      } catch {
        setError(SEND_ERROR);
      }
    });

  const verify = (value: string) => {
    if (!sentTo || value.length !== codeLength) return;
    return guarded(async () => {
      try {
        await verifyEmailCode(getSupabase(), sentTo, value);
      } catch (e) {
        setError(e instanceof InvalidCodeError ? WRONG_CODE : GENERIC_ERROR);
      }
    });
  };

  const onCodeChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, codeLength);
    setCode(digits);
    if (digits.length === codeLength) verify(digits);
  };

  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.form}>
        {sentTo === null ? (
          <>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              Continue with email
            </Text>
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@example.com"
              placeholderTextColor={theme.muted}
              value={email}
              onChangeText={setEmail}
              editable={!busy}
              style={inputStyle}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send code"
              accessibilityState={{ disabled: busy || !emailOk }}
              disabled={busy || !emailOk}
              onPress={() => send(normalised)}
              style={[styles.primary, { backgroundColor: theme.accent, opacity: busy || !emailOk ? 0.5 : 1 }]}
            >
              <Text style={[styles.primaryText, { color: theme.bg }]}>Send code</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              Enter your code
            </Text>
            <Text style={[styles.hint, { color: theme.muted }]}>We sent {articleFor(codeLength)} {codeLength}-digit code to {sentTo}.</Text>
            <TextInput
              accessibilityLabel={`${codeLength}-digit code`}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={codeLength}
              placeholder={'1234567890'.slice(0, codeLength)}
              placeholderTextColor={theme.muted}
              value={code}
              onChangeText={onCodeChange}
              editable={!busy}
              style={inputStyle}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Verify"
              accessibilityState={{ disabled: busy || code.length !== codeLength }}
              disabled={busy || code.length !== codeLength}
              onPress={() => verify(code)}
              style={[styles.primary, { backgroundColor: theme.accent, opacity: busy || code.length !== codeLength ? 0.5 : 1 }]}
            >
              <Text style={[styles.primaryText, { color: theme.bg }]}>Verify</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resend code"
              accessibilityState={{ disabled: busy || resendIn > 0 }}
              disabled={busy || resendIn > 0}
              onPress={() => send(sentTo)}
              style={styles.secondary}
            >
              <Text style={[styles.secondaryText, { color: resendIn > 0 ? theme.muted : theme.text }]}>
                {resendIn > 0 ? `Resend code (${resendIn}s)` : 'Resend code'}
              </Text>
            </Pressable>
          </>
        )}
        {busy ? <ActivityIndicator accessibilityLabel="Working" color={theme.muted} /> : null}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  form: { gap: 12, paddingTop: 24 },
  title: { fontSize: 24, fontWeight: '700' },
  hint: { fontSize: 15 },
  input: { height: 50, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, fontSize: 17 },
  primary: { height: 50, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '600' },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  error: { fontSize: 14 },
});
