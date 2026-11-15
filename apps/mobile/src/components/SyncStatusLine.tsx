import type { SyncStatus } from '@mst/collection-core';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { formatSyncedAgo } from '../sync/relativeTime';
import { useHasSync, usePendingCount, useSyncStatus } from '../sync/SyncProvider';
import { useTheme } from '../theme/useTheme';

export function syncStatusText(status: SyncStatus, pending: number, now: number): string | null {
  switch (status.state) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return "Offline — changes will sync when you're back online";
    case 'error':
      return "Couldn't sync — will retry";
    case 'idle': {
      const synced = status.lastSyncedAt ? `Synced ${formatSyncedAgo(status.lastSyncedAt, now)}` : null;
      if (pending === 0) return synced;
      return synced ? `${synced} · ${pending} to sync` : `${pending} to sync`;
    }
  }
}

function StatusText() {
  const theme = useTheme();
  const status = useSyncStatus();
  const pending = usePendingCount();
  // Re-render every minute so "Synced 5 min ago" stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const text = syncStatusText(status, pending, Date.now());

  // Announce a change to offline or error to screen readers, from the focused screen's line only
  // (several screens in the stack each render one). Not a live region: that would also announce the
  // minute tick ("Synced 5 min ago"), every count change, and every routine sync.
  // Focus and text are read through refs, not effect triggers: refocusing a screen or the minute
  // tick must not repeat an old announcement.
  const focused = useRef(false);
  focused.current = useIsFocused();
  const latestText = useRef(text);
  latestText.current = text;
  const announced = useRef(status.state);
  useEffect(() => {
    if (announced.current === status.state) return;
    announced.current = status.state;
    const alarming = status.state === 'offline' || status.state === 'error';
    if (alarming && focused.current && latestText.current) AccessibilityInfo.announceForAccessibility(latestText.current);
  }, [status.state]);

  if (!text) return null;
  return (
    <Text style={[styles.line, { color: theme.muted }]}>
      {text}
    </Text>
  );
}

/** One muted line describing sync; nothing outside a running sync session. */
export function SyncStatusLine() {
  return useHasSync() ? <StatusText /> : null;
}

const styles = StyleSheet.create({
  line: { fontSize: 12 },
});
