import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CatalogSetSummary } from '../catalog/CatalogContext';
import { useTheme } from '../theme/useTheme';
import { ProgressBar } from './ProgressBar';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function SetRow({
  set,
  collected,
  total,
  onPress,
}: {
  set: CatalogSetSummary;
  collected: number;
  total: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const progress = `${collected} of ${total}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${set.name}, ${progress}`}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.border }]}
    >
      <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {set.logoUrl ? (
          <Image source={{ uri: set.logoUrl }} contentFit="contain" style={styles.logo} accessibilityIgnoresInvertColors />
        ) : (
          <Text style={[styles.initials, { color: theme.muted }]}>{initials(set.name)}</Text>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {set.name}
          </Text>
          <Text style={[styles.progress, { color: theme.muted }]}>{progress}</Text>
        </View>
        <ProgressBar value={total > 0 ? collected / total : 0} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tile: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logo: { width: 40, height: 40 },
  initials: { fontSize: 16, fontWeight: '600' },
  body: { flex: 1, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
  progress: { fontSize: 14 },
});
