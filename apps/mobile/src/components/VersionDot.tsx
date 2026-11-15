import type { VersionKind } from '@mst/catalog-core';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

const RAINBOW = ['#A5B4FC', '#F9A8D4', '#86EFAC', '#FDE68A'] as const;
const MAX_COUNT = 999;

/** The dot (and duplicate badge) without any press handling, for read-only displays. */
export function DotMark({ kind, count }: { kind: VersionKind; count: number }) {
  const theme = useTheme();
  const owned = count >= 1;
  return (
    <View style={styles.hit}>
      {!owned ? (
        <View testID="dot-missing" style={[styles.dot, styles.missing, { borderColor: theme.missing }]} />
      ) : kind.color === 'rainbow' ? (
        <LinearGradient testID="dot-rainbow" colors={RAINBOW} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dot} />
      ) : (
        <View testID="dot-fill" style={[styles.dot, { backgroundColor: kind.color }]} />
      )}
      {count >= 2 ? (
        <View testID="dot-badge" style={[styles.badge, { backgroundColor: theme.text, borderColor: theme.surface }]}>
          <Text style={[styles.badgeText, { color: theme.bg }]}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function VersionDot({
  kind,
  count,
  onTap,
  onLongPress,
  accessibilityLabel,
}: {
  kind: VersionKind;
  count: number;
  onTap(): void;
  onLongPress(): void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      delayLongPress={350}
      onPress={() => {
        // At the cap a tap can't change anything, so don't signal one.
        if (count < MAX_COUNT) void Haptics.selectionAsync();
        onTap();
      }}
      onLongPress={onLongPress}
      style={styles.hit}
    >
      <DotMark kind={kind} count={count} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: 24, height: 28, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7 },
  missing: { borderWidth: 1.5, borderStyle: 'dashed', backgroundColor: 'transparent' },
  badge: {
    position: 'absolute',
    top: 0,
    right: -2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 9, fontWeight: '700' },
});
