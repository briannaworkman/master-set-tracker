import type { VersionKind } from '@mst/catalog-core';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

export function Legend({ kinds }: { kinds: VersionKind[] }) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessibilityLabel="Legend">
      {kinds.map((k) => (
        <View key={k.id} style={styles.item}>
          {k.color === 'rainbow' ? (
            <LinearGradient
              colors={['#A5B4FC', '#F9A8D4', '#86EFAC', '#FDE68A']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.swatch}
            />
          ) : (
            <View style={[styles.swatch, { backgroundColor: k.color }]} />
          )}
          <Text style={[styles.label, { color: theme.muted }]}>{k.label}</Text>
        </View>
      ))}
      <View style={styles.item}>
        <View style={[styles.swatch, styles.missing, { borderColor: theme.missing }]} />
        <Text style={[styles.label, { color: theme.muted }]}>Missing</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  missing: { borderWidth: 1.5, borderStyle: 'dashed' },
  label: { fontSize: 12 },
});
