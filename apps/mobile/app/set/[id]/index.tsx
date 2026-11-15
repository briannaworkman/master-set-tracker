import {
  filterCards,
  legendKinds,
  setProgress,
  setValue,
  versionKey,
  visibleSections,
  type Counts,
  type Filter,
} from '@mst/collection-core';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCatalog } from '../../../src/catalog/CatalogContext';
import { CountPopover } from '../../../src/components/CountPopover';
import { FilterSwitch } from '../../../src/components/FilterSwitch';
import { Legend } from '../../../src/components/Legend';
import { SetGrid, type GridSection } from '../../../src/components/SetGrid';
import { SetHeader } from '../../../src/components/SetHeader';
import { useCounts, useStore, useTracked } from '../../../src/db/StoreContext';
import { usePriceBook } from '../../../src/prices/PriceContext';
import { useTheme } from '../../../src/theme/useTheme';

const NO_HIDDEN: string[] = [];

/**
 * Sticky filter membership: the cards matching a filter are snapshotted when a segment is
 * pressed (including the selected one again) or the screen regains focus, and only then.
 * Tiles keep rendering live counts, so marking a card's last missing version shows its ✓
 * instead of pulling the tile out from under the finger.
 */
function useStickyFilter(sections: GridSection[], counts: Counts) {
  const [filter, setFilter] = useState<Filter>('all');
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string> | null>(null);
  const latest = useRef({ sections, counts, filter });
  latest.current = { sections, counts, filter };

  const snapshot = useCallback((f: Filter) => {
    const { sections: secs, counts: c } = latest.current;
    setVisibleIds(f === 'all' ? null : new Set(secs.flatMap((s) => filterCards(s.cards, c, f)).map((card) => card.id)));
  }, []);

  const changeFilter = useCallback(
    (f: Filter) => {
      setFilter(f);
      snapshot(f);
    },
    [snapshot],
  );

  useFocusEffect(useCallback(() => snapshot(latest.current.filter), [snapshot]));

  return { filter, visibleIds, changeFilter };
}

export default function SetScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(rawId) ? rawId[0]! : rawId;
  const theme = useTheme();
  const router = useRouter();
  const catalog = useCatalog();
  const store = useStore();
  const tracked = useTracked();
  const counts = useCounts(id);
  const prices = usePriceBook();
  const [editing, setEditing] = useState<{ cardId: string; kind: string } | null>(null);

  const set = catalog.getSet(id);
  const hidden = tracked.find((t) => t.setId === id)?.hiddenCategoryIds ?? NO_HIDDEN;
  const kindsById = useMemo(() => Object.fromEntries(catalog.kinds.map((k) => [k.id, k])), [catalog]);
  const sections = useMemo(() => (set ? visibleSections(set, hidden) : []), [set, hidden]);
  const { filter, visibleIds, changeFilter } = useStickyFilter(sections, counts);

  // Stable handlers and derived values: a tap re-renders only the tapped tile.
  const onTapVersion = useCallback((cardId: string, kind: string) => store.tap(id, cardId, kind), [store, id]);
  const onLongPressVersion = useCallback((cardId: string, kind: string) => setEditing({ cardId, kind }), []);
  const onOpenCard = useCallback((cardId: string) => router.push(`/set/${id}/card/${cardId}`), [router, id]);
  const legend = useMemo(() => (set ? legendKinds(set, catalog.kinds) : []), [set, catalog.kinds]);
  const progress = useMemo(() => (set ? setProgress(set, counts, hidden) : null), [set, counts, hidden]);
  const value = useMemo(() => (set ? setValue(set, counts, hidden, prices) : null), [set, counts, hidden, prices]);
  const setName = set?.name;
  const screenOptions = useMemo(
    () => ({
      title: setName,
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Set settings"
          hitSlop={8}
          onPress={() => router.push(`/set/${id}/settings`)}
          style={styles.menu}
        >
          <Text style={[styles.menuText, { color: theme.text }]}>⋯</Text>
        </Pressable>
      ),
    }),
    [setName, id, theme, router],
  );

  if (!set || !progress || !value) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.bg }]}>
        <Text style={[styles.missingText, { color: theme.text }]}>This set isn't available</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={[styles.back, { backgroundColor: theme.accent }]}
        >
          <Text style={[styles.backText, { color: theme.bg }]}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const { collected, total } = progress;
  const emptyText =
    filter === 'missing' && total > 0 && collected === total ? 'You have every version 🎉' : 'Nothing here yet';

  const editingCard = editing ? set.cards.find((c) => c.id === editing.cardId) : undefined;
  const editingKind = editing ? kindsById[editing.kind] : undefined;

  const header = (
    <View style={styles.header}>
      <SetHeader name={set.name} collected={collected} total={total} value={value} />
      <FilterSwitch value={filter} onChange={changeFilter} />
      <Legend kinds={legend} />
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Stack.Screen options={screenOptions} />
      <SetGrid
        sections={sections}
        counts={counts}
        kindsById={kindsById}
        visibleIds={visibleIds}
        header={header}
        emptyText={emptyText}
        onTapVersion={onTapVersion}
        onLongPressVersion={onLongPressVersion}
        onOpenCard={onOpenCard}
      />
      <CountPopover
        visible={editing !== null}
        title={editingCard ? `${editingCard.name} ${editingCard.number}` : ''}
        versionLabel={editingKind?.label ?? ''}
        count={editing ? (counts[versionKey(editing.cardId, editing.kind)] ?? 0) : 0}
        onChange={(n) => editing && store.setCount(id, editing.cardId, editing.kind, n)}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { gap: 12, paddingTop: 8, paddingBottom: 12 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  missingText: { fontSize: 17 },
  back: { minHeight: 44, paddingHorizontal: 24, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 15, fontWeight: '600' },
  menu: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  menuText: { fontSize: 24, fontWeight: '700' },
});
