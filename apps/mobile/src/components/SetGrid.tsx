import type { CatalogCard, SetCategory, VersionKind } from '@mst/catalog-core';
import type { Counts } from '@mst/collection-core';
import { useMemo, type ReactElement } from 'react';
import { SectionList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';
import { CardTile } from './CardTile';

export interface GridSection {
  category: SetCategory;
  cards: CatalogCard[];
}

interface RowSection {
  category: SetCategory;
  data: CatalogCard[][];
}

const GUTTER = 16;
const GAP = 8;
const PER_ROW = 3;

export function SetGrid({
  sections,
  counts,
  kindsById,
  visibleIds,
  header,
  emptyText,
  onTapVersion,
  onLongPressVersion,
  onOpenCard,
}: {
  sections: GridSection[];
  counts: Counts;
  kindsById: Record<string, VersionKind>;
  /**
   * Cards to show, or null for every card. A snapshot taken by the screen, not derived from
   * live counts, so a tile never vanishes from under the finger while marking.
   */
  visibleIds: ReadonlySet<string> | null;
  header?: ReactElement;
  emptyText: string;
  onTapVersion(cardId: string, kind: string): void;
  onLongPressVersion(cardId: string, kind: string): void;
  onOpenCard(cardId: string): void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const tileWidth = (screenWidth - GUTTER * 2 - GAP * (PER_ROW - 1)) / PER_ROW;

  const rowSections = useMemo<RowSection[]>(
    () =>
      sections
        .map(({ category, cards }) => {
          const shown = visibleIds ? cards.filter((c) => visibleIds.has(c.id)) : cards;
          const rows: CatalogCard[][] = [];
          for (let i = 0; i < shown.length; i += PER_ROW) rows.push(shown.slice(i, i + PER_ROW));
          return { category, data: rows };
        })
        .filter((s) => s.data.length > 0),
    [sections, visibleIds],
  );

  return (
    <SectionList
      sections={rowSections}
      extraData={counts}
      keyExtractor={(row) => row[0]!.id}
      ListHeaderComponent={header}
      ListEmptyComponent={<Text style={[styles.empty, { color: theme.muted }]}>{emptyText}</Text>}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 24 }}
      renderSectionHeader={({ section }) =>
        section.category.kind === 'main' ? null : (
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.muted }]}>
            {section.category.label}
          </Text>
        )
      }
      renderItem={({ item: row }) => (
        <View style={styles.row}>
          {row.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              kindsById={kindsById}
              counts={counts}
              width={tileWidth}
              onTapVersion={onTapVersion}
              onLongPressVersion={onLongPressVersion}
              onOpenCard={onOpenCard}
            />
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  sectionTitle: { fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  empty: { fontSize: 15, textAlign: 'center', paddingVertical: 32 },
});
