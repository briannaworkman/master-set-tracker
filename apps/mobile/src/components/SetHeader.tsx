import type { setValue } from '@mst/collection-core';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { ProgressBar } from './ProgressBar';

const money = (n: number) => `$${n.toFixed(2)}`;

/** Progress and value for a set. The set name is the navigation title, so it isn't repeated here. */
export function SetHeader({
  collected,
  total,
  value,
}: {
  collected: number;
  total: number;
  value: ReturnType<typeof setValue>;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
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
  subtitle: { fontSize: 14 },
  bar: { marginTop: 8 },
  value: { fontSize: 14, marginTop: 8 },
});
