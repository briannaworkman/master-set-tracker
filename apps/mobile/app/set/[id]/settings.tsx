import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCatalog } from '../../../src/catalog/CatalogContext';
import { useStore, useTracked } from '../../../src/db/StoreContext';
import { useTheme } from '../../../src/theme/useTheme';

export default function SetSettings() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(rawId) ? rawId[0]! : rawId;
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const catalog = useCatalog();
  const store = useStore();
  const tracked = useTracked().find((t) => t.setId === id);
  const set = catalog.getSet(id);

  if (!set) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.text, fontSize: 17 }}>This set isn't available</Text>
      </View>
    );
  }

  const hidden = tracked?.hiddenCategoryIds ?? [];
  const categories = [...set.categories].sort((a, b) => a.sortOrder - b.sortOrder);

  const toggle = (categoryId: string, on: boolean) =>
    store.setHidden(id, on ? hidden.filter((h) => h !== categoryId) : [...hidden, categoryId]);

  const confirmRemove = () =>
    Alert.alert('Remove from My Sets?', 'Your marks are kept if you add it again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          store.untrack(id);
          router.dismissAll();
        },
      },
    ]);

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <Stack.Screen options={{ title: 'Set settings' }} />
      <Text style={[styles.section, { color: theme.muted }]}>Show in this set</Text>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {categories.map((c, i) => {
          const isMain = c.kind === 'main';
          const on = isMain || !hidden.includes(c.id);
          const locked = isMain || !tracked;
          return (
            <View
              key={c.id}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.label, { color: theme.text }]}>{c.label}</Text>
                {isMain ? <Text style={[styles.helper, { color: theme.muted }]}>Always shown</Text> : null}
              </View>
              <Switch
                accessibilityLabel={c.label}
                value={on}
                disabled={locked}
                accessibilityState={{ disabled: locked }}
                onValueChange={(v) => toggle(c.id, v)}
              />
            </View>
          );
        })}
      </View>
      {!tracked ? (
        <Text style={[styles.note, { color: theme.muted }]}>Add this set to My Sets to change these</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove from My Sets"
          onPress={confirmRemove}
          style={[styles.group, styles.remove, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={[styles.removeText, { color: theme.danger }]}>Remove from My Sets</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  group: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 16, paddingVertical: 8 },
  rowText: { flex: 1, marginRight: 12 },
  label: { fontSize: 16 },
  helper: { fontSize: 13, marginTop: 2 },
  note: { fontSize: 13 },
  remove: { minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  removeText: { fontSize: 16, fontWeight: '600' },
});
