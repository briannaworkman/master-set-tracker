import { spareCount, versionKey } from '@mst/collection-core';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCatalog } from '../../../../src/catalog/CatalogContext';
import { Stepper } from '../../../../src/components/CountPopover';
import { DotMark } from '../../../../src/components/VersionDot';
import { useCounts, useStore } from '../../../../src/db/StoreContext';
import { usePriceBook } from '../../../../src/prices/PriceContext';
import { useTheme } from '../../../../src/theme/useTheme';

const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0]! : (v ?? ''));

export default function CardDetail() {
  const params = useLocalSearchParams<{ id: string; cardId: string }>();
  const id = param(params.id);
  const cardId = param(params.cardId);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const catalog = useCatalog();
  const store = useStore();
  const counts = useCounts(id);
  const prices = usePriceBook();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const set = catalog.getSet(id);
  const card = set?.cards.find((c) => c.id === cardId);
  if (!set || !card) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.text, fontSize: 17 }}>This card isn't available</Text>
      </View>
    );
  }

  const kindsById = Object.fromEntries(catalog.kinds.map((k) => [k.id, k]));
  const category = set.categories.find((c) => c.id === card.categoryId);
  const subtitle = card.rarity ? `${card.number} · ${card.rarity}` : card.number;
  const spares = card.versions.reduce((n, v) => n + spareCount(counts[versionKey(card.id, v.kind)] ?? 0), 0);
  const showImage = card.imageUrl != null && failedUrl !== card.imageUrl;

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <Stack.Screen options={{ title: card.name }} />
      {showImage ? (
        <Image
          testID="detail-image"
          source={{ uri: card.imageUrl! }}
          contentFit="contain"
          style={styles.image}
          onError={() => setFailedUrl(card.imageUrl)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View testID="detail-placeholder" style={[styles.image, styles.placeholder, { backgroundColor: theme.border }]}>
          <Text style={[styles.placeholderText, { color: theme.muted }]}>{card.number}</Text>
        </View>
      )}
      <Text style={[styles.name, { color: theme.text }]}>{card.name}</Text>
      <Text style={[styles.sub, { color: theme.muted }]}>{subtitle}</Text>
      {category && category.kind !== 'main' ? (
        <Text style={[styles.sub, { color: theme.muted }]}>{category.label}</Text>
      ) : null}
      <View style={[styles.rows, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {card.versions.map((v, i) => {
          const kind = kindsById[v.kind];
          if (!kind) return null;
          const key = versionKey(card.id, v.kind);
          const count = counts[key] ?? 0;
          const price = prices.price(id, key);
          return (
            <View
              key={v.kind}
              testID={`version-row-${v.kind}`}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}
            >
              <DotMark kind={kind} count={count} />
              <Text style={[styles.kind, { color: theme.text }]} numberOfLines={1}>
                {kind.label}
              </Text>
              <Text style={[styles.price, { color: theme.muted }]}>{price == null ? '—' : `$${price.toFixed(2)}`}</Text>
              <Stepper label={kind.label} value={count} onChange={(n) => store.setCount(id, card.id, v.kind, n)} />
            </View>
          );
        })}
      </View>
      {spares > 0 ? (
        <Text style={[styles.spares, { color: theme.text }]}>
          {spares === 1 ? '1 spare to trade' : `${spares} spares to trade`}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 16, alignItems: 'stretch', gap: 6 },
  image: { width: '100%', height: 320, marginBottom: 8 },
  placeholder: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 24, fontWeight: '600' },
  name: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sub: { fontSize: 14, textAlign: 'center' },
  rows: { borderRadius: 12, borderWidth: 1, marginTop: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12, gap: 8 },
  kind: { flex: 1, fontSize: 15 },
  price: { fontSize: 14, minWidth: 48, textAlign: 'right' },
  spares: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 12 },
});
