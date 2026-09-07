import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  createHandover,
  formatInr,
  handoverQrPayload,
  sha256Hex,
  type HandoverRecord,
  type Lot,
  type RecyclerMatch,
} from '@ewaste/shared';
import { Screen, Card, PrimaryButton, Banner, Muted } from '../ui/components.tsx';
import { colors, radius, spacing, type } from '../ui/theme.ts';
import { useApp } from '../state/AppContext.tsx';
import { speak } from '../audio/tts.ts';
import { saveHandover } from '../db/index.ts';

/**
 * The handover slip.
 *
 * This screen is the reason the app exists: it turns "I sold some wire to a
 * man" into a signed, timestamped, located record with a reference the
 * recycler confirms. It is built and signed entirely on the phone - no
 * network - and queued for upload afterwards.
 *
 * The six-digit code is shown as large as the QR because scanning fails
 * constantly in practice: cracked screens, bright sun, a recycler with no
 * camera. Reading a number aloud always works.
 */
export function HandoverSlip({
  lot,
  match,
  onBack,
  onDone,
}: {
  lot: Lot;
  match: RecyclerMatch;
  onBack: () => void;
  onDone: () => void;
}) {
  const { t, language, deviceSecret, collectorId, syncNow } = useApp();
  const [record, setRecord] = useState<HandoverRecord>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const now = new Date().toISOString();
    const created = createHandover(
      {
        lotId: lot.lotId,
        collectorId,
        recyclerId: match.recycler.recyclerId,
        declaredWeightKg: lot.totalWeightKg,
        // The scale reading is the recycler's to enter; until then the
        // collector's own figure stands.
        weighedWeightKg: lot.totalWeightKg,
        photoHashes: lot.items.flatMap((item) =>
          item.imageRefs.map((ref) => sha256Hex(`${ref}:${item.createdAt}`).slice(0, 12)),
        ),
        handoverPoint: lot.collectionPlace.point ?? { lat: 0, lon: 0 },
        handoverPlace: {
          locality: match.recycler.place.locality,
          district: match.recycler.place.district,
          state: match.recycler.place.state,
        },
        createdAt: now,
      },
      deviceSecret,
      lot.items.flatMap((item) => item.imageRefs),
    );
    setRecord(created);
    void saveHandover(created).then(() => {
      setSaved(true);
      // Try to upload immediately, but the slip is already valid without it.
      void syncNow();
    });
  }, [lot, match, collectorId, deviceSecret, syncNow]);

  if (!record) {
    return (
      <Screen title={t('handover.title')} onBack={onBack}>
        <Muted>…</Muted>
      </Screen>
    );
  }

  const spokenCode = record.verificationCode.split('').join(' ');

  return (
    <Screen
      title={t('handover.title')}
      speakText={`${t('handover.code_label')} ${spokenCode}`}
      onBack={onBack}
      footer={<PrimaryButton glyph="✅" label={t('action.done')} onPress={onDone} />}
    >
      <Banner tone="ok">
        <Text style={[type.body, { color: colors.ok }]}>{t('handover.show_to_buyer')}</Text>
        <Text style={[type.small, { color: colors.ok }]}>{t('handover.works_offline')}</Text>
      </Banner>

      <Card style={{ alignItems: 'center', backgroundColor: colors.bg }}>
        <View style={styles.qrFrame}>
          <QRCode value={handoverQrPayload(record)} size={210} backgroundColor="#FFFFFF" color="#000000" />
        </View>
        <Text style={styles.reference}>{record.handoverRef}</Text>
      </Card>

      <Card style={{ alignItems: 'center' }}>
        <Text style={[type.body, { color: colors.textMuted }]}>{t('handover.code_label')}</Text>
        <Text
          style={styles.code}
          onPress={() => void speak(spokenCode, language)}
          accessibilityRole="button"
        >
          {record.verificationCode}
        </Text>
        <Muted>🔊</Muted>
      </Card>

      <Card>
        <Row label={t('handover.weight_label')} value={`${lot.totalWeightKg} ${t('lot.weight_unit_kg')}`} />
        <Row label={t('lot.estimate_title')} value={formatInr(lot.estimatedValueInr)} />
        <Row label={t('match.title')} value={match.recycler.name} />
        <Row label={t('match.pays')} value={formatInr(match.estimatedPayoutInr)} />
      </Card>

      <Card>
        <Text style={[type.small, { color: colors.textMuted }]}>
          {saved ? t('lot.saved_offline') : '…'}
        </Text>
        <Text style={[type.small, { color: colors.textMuted }]}>{t('handover.waiting_confirm')}</Text>
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={[type.small, { color: colors.textMuted, flex: 1 }]}>{label}</Text>
      <Text style={[type.body, { color: colors.text, flex: 1, textAlign: 'right' }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  qrFrame: { padding: spacing.md, backgroundColor: '#FFFFFF', borderRadius: radius.md },
  reference: { fontSize: 22, fontWeight: '800', letterSpacing: 2, color: colors.text, marginTop: spacing.sm },
  code: { fontSize: 52, fontWeight: '800', letterSpacing: 8, color: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
