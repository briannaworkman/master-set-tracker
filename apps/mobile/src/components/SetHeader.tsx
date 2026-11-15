import type { setValue } from '@mst/collection-core';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { ProgressBar } from './ProgressBar';

const money = (n: number) => `$${n.toFixed(2)}`;

export function SetHeader({
  name,
  collected,
  total,
  value,
}: {
  name: string;
  collected: number;
  total: number;
  value: ReturnType<typeof setValue>;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
        {name}
      </Text>
      <Text style={[styles.subtitle, { color: theme.muted }]}>
        {`Master set · ${collected} of ${total} collected`}
      </Text>
      <View style={styles.bar}>
        <ProgressBar value={total > 0 ? collected / total : 0} />
      </View>
      {value.hasPrices ? (
        <Text style={[styles.value, { color: theme.text }]}>
          {`Owned ${money(value.owned)} · To finish ≈ ${money(value.toFinish)}`}
          {value.incomplete ? <Text style={{ color: theme.muted }}>{'  Some prices unavailable'}</Text> : null}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 14 },
  bar: { marginTop: 8 },
  value: { fontSize: 14, marginTop: 8 },
});
