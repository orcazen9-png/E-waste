import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatInr } from '@ewaste/shared';
import { colors, radius, spacing, type } from '../ui/theme.ts';
import { useApp } from '../state/AppContext.tsx';
import { SpeakButton } from '../ui/components.tsx';

export type HomeDestination = 'newLot' | 'prices' | 'ledger' | 'safety';

/**
 * Home is four things, big. Anything that is not one of the four jobs a
 * collector opens the app to do belongs somewhere else.
 */
export function Home({
  onNavigate,
  pendingDuesInr,
  earnedThisWeekInr,
}: {
  onNavigate: (destination: HomeDestination) => void;
  pendingDuesInr: number;
  earnedThisWeekInr: number;
}) {
  const { t, language, sync, syncNow } = useApp();

  const tiles: Array<{ key: HomeDestination; glyph: string; label: string; tone?: 'primary' }> = [
    { key: 'newLot', glyph: '📷', label: t('home.new_lot'), tone: 'primary' },
    { key: 'prices', glyph: '💰', label: t('home.price_board') },
    { key: 'ledger', glyph: '📒', label: t('home.earnings') },
    { key: 'safety', glyph: '🛡️', label: t('home.safety') },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Text style={[type.title, { flex: 1, color: colors.text }]}>{t('home.title')}</Text>
        <SpeakButton text={t('home.title')} language={language} />
      </View>

      <Pressable style={styles.syncBar} onPress={() => void syncNow()} accessibilityRole="button">
        <Text style={styles.syncGlyph}>
          {sync.kind === 'syncing' ? '🔄' : sync.kind === 'offline' ? '📴' : sync.pending > 0 ? '⏳' : '✅'}
        </Text>
        <Text style={styles.syncText}>
          {sync.kind === 'syncing'
            ? t('sync.syncing')
            : sync.kind === 'offline'
              ? t('sync.offline')
              : sync.pending > 0
                ? t('sync.pending', { count: sync.pending })
                : t('sync.done')}
        </Text>
      </Pressable>

      <View style={styles.grid}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            style={({ pressed }) => [
              styles.tile,
              tile.tone === 'primary' && styles.tilePrimary,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => onNavigate(tile.key)}
            accessibilityRole="button"
            accessibilityLabel={tile.label}
          >
            <Text style={styles.tileGlyph}>{tile.glyph}</Text>
            <Text
              style={[type.body, { color: tile.tone === 'primary' ? colors.primaryText : colors.text, textAlign: 'center' }]}
            >
              {tile.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Money owed is the single number collectors care most about, so it is
          on the home screen rather than buried in the ledger. */}
      <Pressable style={styles.moneyStrip} onPress={() => onNavigate('ledger')}>
        <View style={{ flex: 1 }}>
          <Text style={styles.moneyLabel}>{t('ledger.this_week')}</Text>
          <Text style={styles.moneyValue}>{formatInr(earnedThisWeekInr)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.moneyLabel}>{t('ledger.pending')}</Text>
          <Text style={[styles.moneyValue, pendingDuesInr > 0 && { color: colors.warn }]}>
            {formatInr(pendingDuesInr)}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md, paddingTop: spacing.xl, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  syncGlyph: { fontSize: 20 },
  syncText: { flex: 1, fontSize: 15, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 150,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  tilePrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  tileGlyph: { fontSize: 46 },
  moneyStrip: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  moneyLabel: { fontSize: 14, color: colors.textMuted },
  moneyValue: { fontSize: 26, fontWeight: '800', color: colors.money },
});
