import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatInr } from '@ewaste/shared';
import { Screen, Card, Muted } from '../ui/components.tsx';
import { colors, radius, spacing, type } from '../ui/theme.ts';
import { useApp } from '../state/AppContext.tsx';
import { listTransactions, type LocalTransaction } from '../db/index.ts';

/**
 * The earnings ledger, read entirely from the local database.
 *
 * Two numbers matter more than the list: what came in, and what is still owed.
 * Unpaid rows are marked in the same colour everywhere in the app, and a
 * flagged transaction says so plainly - this is often the first time a
 * collector has had a written record to point at.
 */
export function Ledger({ onBack }: { onBack: () => void }) {
  const { t } = useApp();
  const [rows, setRows] = useState<LocalTransaction[]>([]);

  useEffect(() => {
    void listTransactions().then(setRows);
  }, []);

  const totals = useMemo(() => {
    const paid = rows.filter((r) => r.paymentStatus === 'paid');
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      earned: paid.reduce((s, r) => s + r.finalPriceInr, 0),
      week: paid.filter((r) => Date.parse(r.handoverAt) >= weekAgo).reduce((s, r) => s + r.finalPriceInr, 0),
      pending: rows
        .filter((r) => r.paymentStatus !== 'paid')
        .reduce((s, r) => s + (r.paymentStatus === 'partial' ? r.finalPriceInr / 2 : r.finalPriceInr), 0),
    };
  }, [rows]);

  return (
    <Screen title={t('ledger.title')} onBack={onBack}>
      <View style={styles.summaryRow}>
        <Summary label={t('ledger.this_week')} value={formatInr(totals.week)} />
        <Summary label={t('ledger.pending')} value={formatInr(totals.pending)} tone={totals.pending > 0 ? 'warn' : undefined} />
      </View>
      <Card>
        <Text style={[type.small, { color: colors.textMuted }]}>{t('ledger.total_earned')}</Text>
        <Text style={styles.total}>{formatInr(totals.earned)}</Text>
      </Card>

      {rows.length === 0 && <Muted>{t('ledger.empty')}</Muted>}

      {rows.map((row) => (
        <View key={row.transactionId} style={styles.row}>
          <Text style={styles.rowGlyph}>
            {row.paymentStatus === 'paid' ? '✅' : row.paymentStatus === 'partial' ? '🟡' : '⏳'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: colors.text }]}>
              {`${row.totalWeightKg} kg`}
            </Text>
            <Muted>
              {new Date(row.handoverAt).toLocaleDateString()} ·{' '}
              {t(`ledger.${row.paymentMode}` as Parameters<typeof t>[0])}
            </Muted>
            {row.anomalyFlags.length > 0 && (
              <Text style={[type.small, { color: colors.warn }]}>⚠ {t('anomaly.price_below')}</Text>
            )}
          </View>
          <Text
            style={[
              styles.amount,
              row.paymentStatus !== 'paid' && { color: colors.warn },
            ]}
          >
            {formatInr(row.finalPriceInr)}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <View style={styles.summary}>
      <Text style={[type.small, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.summaryValue, tone === 'warn' && { color: colors.warn }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', gap: spacing.md },
  summary: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  summaryValue: { fontSize: 26, fontWeight: '800', color: colors.money },
  total: { fontSize: 34, fontWeight: '800', color: colors.money },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowGlyph: { fontSize: 26 },
  amount: { fontSize: 21, fontWeight: '800', color: colors.money },
});
