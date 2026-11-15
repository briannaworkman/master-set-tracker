import { StyleSheet, Text, View } from 'react-native';
import { WebPreviewNote } from '../src/components/WebPreviewNote';
import { useTheme } from '../src/theme/useTheme';

/** Placeholder home: the empty state only. Task 4 builds the real My Sets screen. */
export default function HomeScreen() {
  const theme = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <WebPreviewNote />
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: theme.muted }]}>Add a set to start tracking</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 17 },
});
