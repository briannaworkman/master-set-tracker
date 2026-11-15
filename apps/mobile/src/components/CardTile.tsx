import type { CatalogCard, VersionKind } from '@mst/catalog-core';
import { cardStatus, versionKey, type Counts } from '@mst/collection-core';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { VersionDot } from './VersionDot';

export function CardTile({
  card,
  kindsById,
  counts,
  width,
  onTapVersion,
  onLongPressVersion,
  onOpenCard,
}: {
  card: CatalogCard;
  kindsById: Record<string, VersionKind>;
  counts: Counts;
  width: number;
  onTapVersion(kind: string): void;
  onLongPressVersion(kind: string): void;
  onOpenCard(): void;
}) {
  const theme = useTheme();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const status = cardStatus(card, counts);
  const imageHeight = Math.round(width * 0.72);
  const showImage = card.imageUrl != null && failedUrl !== card.imageUrl;
  return (
    <View style={[styles.tile, { width, backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${card.name} ${card.number}${status === 'complete' ? ', complete' : ''}`}
        onPress={onOpenCard}
        style={{ height: imageHeight }}
      >
        {showImage ? (
          <Image
            testID="tile-image"
            source={{ uri: card.imageUrl! }}
            contentFit="contain"
            style={[styles.fill, status === 'none' && styles.dimmed]}
            onError={() => setFailedUrl(card.imageUrl)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View testID="tile-placeholder" style={[styles.fill, styles.placeholder, { backgroundColor: theme.border }]}>
            <Text style={[styles.placeholderText, { color: theme.muted }]}>{card.number}</Text>
          </View>
        )}
        {status === 'none' ? (
          <View testID="tile-faded" pointerEvents="none" style={[styles.fill, styles.overlay, { backgroundColor: theme.bg }]} />
        ) : null}
        {status === 'complete' ? (
          <View testID="tile-complete" style={styles.check}>
            <Text style={styles.checkText}>✓</Text>
          </View>
        ) : null}
      </Pressable>
      <Text style={[styles.number, { color: theme.muted }]}>{card.number}</Text>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.name, { color: theme.text }]}>
        {card.name}
      </Text>
      <View style={styles.dots}>
        {card.versions.map((v) => {
          const kind = kindsById[v.kind];
          if (!kind) return null;
          const count = counts[versionKey(card.id, v.kind)] ?? 0;
          return (
            <VersionDot
              key={v.kind}
              kind={kind}
              count={count}
              onTap={() => onTapVersion(v.kind)}
              onLongPress={() => onLongPressVersion(v.kind)}
              accessibilityLabel={`${card.name} ${card.number}, ${kind.label}, ${count} owned`}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 12, borderWidth: 1, padding: 6 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dimmed: { opacity: 0.35 },
  overlay: { opacity: 0.4 },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  placeholderText: { fontSize: 13, fontWeight: '600' },
  check: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    // Literal colours: the badge sits on card art, which does not change with the theme.
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { fontSize: 10, fontWeight: '700', color: '#1D1B18' },
  number: { fontSize: 9, marginTop: 4 },
  name: { fontSize: 11, fontWeight: '600' },
  dots: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
});
