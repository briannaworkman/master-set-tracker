import type { Filter } from '@mst/collection-core';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

const SEGMENTS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Missing' },
  { value: 'have', label: 'Have' },
  { value: 'spares', label: 'Spares' },
];

export const FilterSwitch = memo(function FilterSwitch({
  value,
  onChange,
}: {
  value: Filter;
  onChange(filter: Filter): void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.border }]}>
      {SEGMENTS.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(s.value)}
            style={[styles.segment, selected && { backgroundColor: theme.surface }]}
          >
            <Text style={[styles.label, { color: selected ? theme.text : theme.muted }]}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: 10, padding: 2 },
  segment: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600' },
});
