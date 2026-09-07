import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  MATERIAL_CATEGORIES,
  computeTrend,
  formatInr,
  lookupStat,
  speakPrice,
  statKey,
} from '@ewaste/shared';
import { Screen, Muted } from '../ui/components.tsx';
import { colors, radius, spacing, type } from '../ui/theme.ts';
import { useApp } from '../state/AppContext.tsx';
import { speak } from '../audio/tts.ts';

/**
 * The price board, computed entirely from the cached index so it works with no
 * connectivity. Each row speaks its own price: this screen exists so a
 * collector can walk into a negotiation already knowing the number.
 */
export function PriceBoard({ onBack }: { onBack: () => void }) {
  const { t, language, priceIndex, priceIndexFetchedAt, district } = useApp();

  const rows = useMemo(() => {
    if (!priceIndex) return [];
    return MATERIAL_CATEGORIES.flatMap((category) =>
      category.subCategories.flatMap((sub) => {
        const stat = lookupStat(priceIndex, sub.id, district);
        if (!stat) return [];
        const isLocal = priceIndex.stats[statKey(sub.id, district)] !== undefined;
        return [
          {
            categoryId: category.id,
            glyph: sub.glyph,
            label: t(sub.labelKey as Parameters<typeof t>[0]),
            price: stat.medianBuyingInr,
            unit: sub.unit,
            trend: computeTrend(stat, '7d'),
            isLocal,
          },
        ];
      }),
    );
  }, [priceIndex, district, t]);

  const stale = priceIndexFetchedAt
    ? Date.now() - Date.parse(priceIndexFetchedAt) > 3 * 86_400_000
    : false;

  return (
    <Screen title={t('price.board_title')} onBack={onBack}>
      {!priceIndex && (
        <View style={styles.empty}>
          <Text style={styles.emptyGlyph}>📶</Text>
          <Text style={[type.body, { textAlign: 'center', color: colors.textMuted }]}>
            {t('sync.offline')}
          </Text>
        </View>
      )}

      {stale && (
        <View style={styles.staleBanner}>
          <Text style={{ fontSize: 20 }}>⚠️</Text>
          <Text style={[type.small, { flex: 1, color: colors.warn }]}>{t('price.old_data')}</Text>
        </View>
      )}

      {rows.map((row) => (
        <Pressable
          key={`${row.categoryId}:${row.label}`}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
          onPress={() => void speak(`${row.label}. ${speakPrice(language, row.price, row.unit)}`, language)}
          accessibilityRole="button"
          accessibilityLabel={`${row.label} ${formatInr(row.price)}`}
        >
          <Text style={styles.rowGlyph}>{row.glyph}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
              {row.label}
            </Text>
            <Muted>
              {row.unit === 'kg' ? t('price.per_kg') : t('price.per_piece')}
              {!row.isLocal ? ' · ' + t('valuation.reason.reference_band') : ''}
            </Muted>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.price}>{formatInr(row.price)}</Text>
            <Text style={styles.trend}>
              {row.trend.direction === 'up' ? '▲' : row.trend.direction === 'down' ? '▼' : '▬'}{' '}
              {Math.abs(row.trend.changePct).toFixed(0)}%
            </Text>
          </View>
          <Text style={styles.speaker}>🔊</Text>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    minHeight: 76,
  },
  rowGlyph: { fontSize: 32 },
  price: { fontSize: 22, fontWeight: '800', color: colors.money },
  trend: { fontSize: 13, color: colors.textMuted },
  speaker: { fontSize: 22 },
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  emptyGlyph: { fontSize: 56 },
  staleBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.warnBg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
});
