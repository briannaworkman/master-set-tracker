import { setProgress, type TrackedSet } from '@mst/collection-core';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCatalog } from '../src/catalog/CatalogContext';
import { SetRow } from '../src/components/SetRow';
import { SyncStatusLine } from '../src/components/SyncStatusLine';
import { WebPreviewNote } from '../src/components/WebPreviewNote';
import { useCounts, useTracked } from '../src/db/StoreContext';
import { useTheme } from '../src/theme/useTheme';

function TrackedRow({ tracked }: { tracked: TrackedSet }) {
  const catalog = useCatalog();
  const router = useRouter();
  const counts = useCounts(tracked.setId);
  const set = catalog.getSet(tracked.setId);
  const summary = catalog.listSets().find((s) => s.id === tracked.setId);
  // A tracked set missing from the catalog (e.g. a draft in a production build) is skipped.
  if (!set || !summary) return null;
  const { collected, total } = setProgress(set, counts, tracked.hiddenCategoryIds);
  return (
    <SetRow
      set={summary}
      collected={collected}
      total={total}
      onPress={() => router.push(`/set/${tracked.setId}`)}
    />
  );
}

function AddSetButton() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add set"
      hitSlop={{ top: 2, bottom: 2 }}
      onPress={() => router.push('/browse')}
      style={[styles.addButton, { backgroundColor: theme.accent }]}
    >
      <Text style={[styles.addText, { color: theme.bg }]}>Add set</Text>
    </Pressable>
  );
}

/** A simple person glyph (head and shoulders), drawn so it needs no icon font. */
function PersonGlyph({ color }: { color: string }) {
  return (
    <View style={styles.glyph}>
      <View style={[styles.glyphHead, { borderColor: color }]} />
      <View style={[styles.glyphBody, { borderColor: color }]} />
    </View>
  );
}

function AccountButton() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Account"
      onPress={() => router.push('/account')}
      style={[styles.accountButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
    >
      <PersonGlyph color={theme.text} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const tracked = useTracked();
  const catalog = useCatalog();
  const hasVisible = tracked.some((t) => catalog.getSet(t.setId));
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <WebPreviewNote />
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            My Sets
          </Text>
          <SyncStatusLine />
        </View>
        <View style={styles.headerActions}>
          {hasVisible ? <AddSetButton /> : null}
          <AccountButton />
        </View>
      </View>
      {hasVisible ? (
        <FlatList data={tracked} keyExtractor={(t) => t.setId} renderItem={({ item }) => <TrackedRow tracked={item} />} />
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.muted }]}>Add a set to start tracking</Text>
          <AddSetButton />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  titleBlock: { flexShrink: 1, gap: 2 },
  title: { fontSize: 28, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  emptyText: { fontSize: 17 },
  addButton: { paddingHorizontal: 16, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 15, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { width: 20, height: 20, alignItems: 'center', justifyContent: 'flex-end' },
  glyphHead: { width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.75, marginBottom: 1.5 },
  glyphBody: {
    width: 16,
    height: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1.75,
    borderBottomWidth: 0,
  },
});
