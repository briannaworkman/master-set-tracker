import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  confirmDestructive,
  deleteAccountFlow,
  DELETE_ERROR,
  identityText,
  SIGN_OUT_ERROR,
  signOutFlow,
} from '../src/account/flows';
import { useAuth } from '../src/auth/AuthProvider';
import { getSupabase } from '../src/backend/supabase';
import { SyncStatusLine } from '../src/components/SyncStatusLine';
import { useSyncNow, useSyncSession } from '../src/sync/SyncProvider';
import { useTheme, type Theme } from '../src/theme/useTheme';

function ActionButton({
  label,
  onPress,
  disabled,
  danger,
  theme,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
  theme: Theme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.group,
        styles.button,
        { backgroundColor: theme.surface, borderColor: theme.border, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: danger ? theme.danger : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

export default function AccountScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { email, provider } = useAuth();
  const session = useSyncSession();
  const syncNow = useSyncNow();
  const [busy, setBusy] = useState<'signOut' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const run = async (kind: 'signOut' | 'delete') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setError(null);
    try {
      const client = getSupabase();
      const result =
        kind === 'signOut'
          ? await signOutFlow(client, { session, syncNow, confirm: confirmDestructive })
          : await deleteAccountFlow(client, { session, confirm: confirmDestructive });
      if (result === 'failed' && mounted.current) setError(kind === 'signOut' ? SIGN_OUT_ERROR : DELETE_ERROR);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  };

  const disabled = busy !== null;
  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <View style={[styles.group, styles.identity, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.identityText, { color: theme.text }]}>{identityText(email, provider)}</Text>
        <SyncStatusLine />
      </View>
      <ActionButton label="Sync now" onPress={() => void syncNow()} disabled={disabled} theme={theme} />
      <ActionButton label="Sign out" onPress={() => void run('signOut')} disabled={disabled} theme={theme} />
      <ActionButton label="Delete account" onPress={() => void run('delete')} disabled={disabled} danger theme={theme} />
      {busy ? (
        <ActivityIndicator
          accessibilityLabel={busy === 'signOut' ? 'Signing out' : 'Deleting account'}
          color={theme.muted}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  group: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  identity: { paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  identityText: { fontSize: 17, fontWeight: '600' },
  button: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  error: { fontSize: 14, textAlign: 'center' },
});
