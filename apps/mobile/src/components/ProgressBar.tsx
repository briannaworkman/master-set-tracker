import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

/** Thin progress bar; `value` is 0..1. */
export function ProgressBar({ value }: { value: number }) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <View style={[styles.track, { backgroundColor: theme.border }]}>
      <View style={[styles.fill, { backgroundColor: theme.accent, width: `${pct}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
