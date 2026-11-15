import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCatalog, type CatalogSetSummary } from '../src/catalog/CatalogContext';
import { useStore, useTracked } from '../src/db/StoreContext';
import { useTheme } from '../src/theme/useTheme';

function BrowseRow({ set, added, onAdd }: { set: CatalogSetSummary; added: boolean; onAdd: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <View style={styles.body}>
        <View style={styles.nameLine}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {set.name}
          </Text>
          {!set.published ? (
            <View style={[styles.pill, { borderColor: theme.muted }]}>
              <Text style={[styles.pillText, { color: theme.muted }]}>Draft</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>
          {set.series} · {set.releaseDate.slice(0, 4)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={added ? `${set.name} added` : `Add ${set.name}`}
        accessibilityState={{ disabled: added }}
        disabled={added}
        hitSlop={{ top: 4, bottom: 4 }}
        onPress={onAdd}
        style={[styles.button, added ? { borderColor: theme.border, borderWidth: 1 } : { backgroundColor: theme.accent }]}
      >
        <Text style={[styles.buttonText, { color: added ? theme.muted : theme.bg }]}>{added ? 'Added ✓' : 'Add'}</Text>
      </Pressable>
    </View>
  );
}

export default function BrowseScreen() {
  const theme = useTheme();
  const router = useRouter();
  const catalog = useCatalog();
  const store = useStore();
  const tracked = useTracked();
  const trackedIds = new Set(tracked.map((t) => t.setId));
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <FlatList
        data={catalog.listSets()}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <BrowseRow
            set={item}
            added={trackedIds.has(item.id)}
            onAdd={() => {
              store.track(item.id);
              router.back();
            }}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { flex: 1, gap: 4 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 14 },
  pill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  pillText: { fontSize: 11, fontWeight: '600' },
  button: { minWidth: 72, height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
