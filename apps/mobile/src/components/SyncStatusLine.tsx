import type { SyncStatus } from '@mst/collection-core';
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

  // Announce a change of state (syncing, offline, error, idle) to screen readers. Not a live
  // region: that would also announce the minute tick ("Synced 5 min ago") and every count change.
  const announced = useRef(status.state);
  const latestText = useRef(text);
  latestText.current = text;
  useEffect(() => {
    if (announced.current === status.state) return;
    announced.current = status.state;
    if (latestText.current) AccessibilityInfo.announceForAccessibility(latestText.current);
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
