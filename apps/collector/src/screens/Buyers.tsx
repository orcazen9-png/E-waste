import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  WeightedRecyclerMatcher,
  formatInr,
  type GeoPoint,
  type Lot,
  type Recycler,
  type RecyclerMatch,
} from '@ewaste/shared';
import { Screen, Card, Muted, PrimaryButton, Banner } from '../ui/components.tsx';
import { colors, radius, spacing, type } from '../ui/theme.ts';
import { useApp } from '../state/AppContext.tsx';

/**
 * Ranked buyers for a lot.
 *
 * Matching runs on the phone against the cached recycler list and price index,
 * so it works with no signal. Every card states the payout, the distance and
 * whether they collect - and every card carries the reasons it was ranked
 * where it was, because a recommendation a collector cannot interrogate is
 * just another middleman telling them where to sell.
 */
export function Buyers({
  lot,
  onBack,
  onChoose,
}: {
  lot: Lot;
  onBack: () => void;
  onChoose: (match: RecyclerMatch) => void;
}) {
  const { t, tc, priceIndex, recyclers } = useApp();
  const [maxDistanceKm, setMaxDistanceKm] = useState(25);

  // Reference data genuinely requires one sync. A GPS fix does not: matching
  // runs entirely on the phone, and refusing to show any buyer because
  // location is off - which it often is, to save battery, or indoors - fails
  // the collector exactly when they need a buyer.
  const needsSync = !priceIndex || recyclers.length === 0;

  const exactPoint = lot.collectionPlace.point;
  const approxPoint = useMemo(
    () => exactPoint ?? districtCentre(recyclers, lot.collectionPlace.district),
    [exactPoint, recyclers, lot.collectionPlace.district],
  );

  const result = useMemo(() => {
    if (!priceIndex || !approxPoint || recyclers.length === 0) return undefined;
    return new WeightedRecyclerMatcher().match({
      lot,
      collectorPoint: approxPoint,
      recyclers,
      priceIndex,
      preferredPayment: 'cash',
      maxDistanceKm,
      limit: 8,
    });
  }, [lot, priceIndex, recyclers, approxPoint, maxDistanceKm]);

  // Widen the search automatically rather than showing an empty screen: a
  // collector holding 20 kg of cable needs a buyer, not a filter tutorial.
  useEffect(() => {
    if (result && result.matches.length === 0 && maxDistanceKm < 60) {
      setMaxDistanceKm((km) => km + 20);
    }
  }, [result, maxDistanceKm]);

  return (
    <Screen title={t('match.title')} onBack={onBack}>
      <Card>
        <Text style={[type.body, { color: colors.text }]}>
          {`${lot.totalWeightKg} ${t('lot.weight_unit_kg')} · ${formatInr(lot.estimatedValueInr)}`}
        </Text>
      </Card>

      {needsSync && (
        <Banner tone="warn">
          <Text style={type.body}>{t('match.need_sync')}</Text>
        </Banner>
      )}

      {/* Location off is a different problem from no data, and says so. */}
      {!needsSync && !exactPoint && (
        <Banner tone="warn">
          <Text style={type.small}>📍 {t('match.no_location')}</Text>
        </Banner>
      )}

      {result?.matches.length === 0 && (
        <Banner tone="warn">
          <Text style={type.body}>{t('match.no_results')}</Text>
        </Banner>
      )}

      {result?.matches.map((match, index) => (
        <Pressable
          key={match.recycler.recyclerId}
          style={({ pressed }) => [styles.card, index === 0 && styles.best, pressed && { opacity: 0.85 }]}
          onPress={() => onChoose(match)}
          accessibilityRole="button"
        >
          <View style={styles.headerRow}>
            <Text style={[type.body, { flex: 1, color: colors.text }]} numberOfLines={2}>
              {match.recycler.name}
            </Text>
            <Text style={styles.payout}>{formatInr(match.estimatedPayoutInr)}</Text>
          </View>

          <View style={styles.badges}>
            <Badge glyph="✅" text={t('match.authorized_badge')} tone="ok" />
            <Badge glyph="📍" text={t('match.distance', { km: match.distanceKm })} />
            <Badge
              glyph={match.pickupOffered ? '🚚' : '🚶'}
              text={match.pickupOffered ? t('match.pickup_yes') : t('match.pickup_no')}
            />
          </View>

          {match.reasons.map((coded) => (
            <Text key={coded} style={[type.small, { color: colors.ok }]}>
              • {tc(coded)}
            </Text>
          ))}
          {match.warnings.map((coded) => (
            <Text key={coded} style={[type.small, { color: colors.warn }]}>
              ⚠ {tc(coded)}
            </Text>
          ))}

          <View style={styles.actions}>
            <Pressable
              style={styles.callBtn}
              onPress={() => void Linking.openURL(`tel:${match.recycler.contactPhone}`)}
              accessibilityLabel={t('action.call')}
            >
              <Text style={{ fontSize: 20 }}>📞</Text>
              <Text style={type.small}>{t('action.call')}</Text>
            </Pressable>
          </View>
        </Pressable>
      ))}

      {result && result.excluded.length > 0 && (
        <Card>
          <Muted>{t('match.excluded_count', { count: result.excluded.length })}</Muted>
          {result.excluded.slice(0, 4).map((entry) => (
            <Text key={entry.recyclerId} style={[type.small, { color: colors.textMuted }]}>
              • {tc(entry.reason)}
            </Text>
          ))}
        </Card>
      )}

      {result && result.matches.length > 0 && (
        <PrimaryButton
          tone="neutral"
          label={`+20 km`}
          onPress={() => setMaxDistanceKm((km) => km + 20)}
        />
      )}
    </Screen>
  );
}

/**
 * A stand-in for the collector's position when there is no fix: the mean of
 * the known authorised facilities in their district. Crude, but it keeps the
 * ranking working and the distances honestly labelled as rough.
 */
function districtCentre(recyclers: Recycler[], district: string): GeoPoint | undefined {
  const points = recyclers
    .filter((r) => r.place.district === district && r.place.point)
    .map((r) => r.place.point!);
  if (points.length === 0) return undefined;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  };
}

function Badge({ glyph, text, tone }: { glyph: string; text: string; tone?: 'ok' }) {
  return (
    <View style={[styles.badge, tone === 'ok' && { backgroundColor: colors.okBg }]}>
      <Text style={{ fontSize: 14 }}>{glyph}</Text>
      <Text style={[type.small, { color: tone === 'ok' ? colors.ok : colors.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  best: { borderColor: colors.primary, backgroundColor: colors.okBg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  payout: { fontSize: 24, fontWeight: '800', color: colors.money },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
