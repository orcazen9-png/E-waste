import { useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import {
  MATERIAL_CATEGORIES,
  formatInr,
  getCategory,
  newLotId,
  newMaterialId,
  safetyCardsFor,
  sha256Hex,
  speakEstimate,
  type Lot,
  type MaterialCategoryId,
  type MaterialCondition,
  type GeoPoint,
  type MaterialItem,
  type SubCategory,
  type Valuation,
} from '@ewaste/shared';
import { Screen, PictureTile, PrimaryButton, Card, Banner, Muted } from '../ui/components.tsx';
import { categoryColors, colors, radius, spacing, TOUCH_MIN, type } from '../ui/theme.ts';
import { useApp, useValuer } from '../state/AppContext.tsx';
import { speak } from '../audio/tts.ts';
import { saveLot } from '../db';

type Step = 'photo' | 'category' | 'subcategory' | 'weight' | 'condition' | 'estimate';

const CONDITIONS: Array<{ id: MaterialCondition; glyph: string }> = [
  { id: 'intact', glyph: '📦' },
  { id: 'partially_dismantled', glyph: '🔧' },
  { id: 'broken', glyph: '💔' },
  { id: 'wet', glyph: '💧' },
  { id: 'burnt', glyph: '🔥' },
];

/**
 * Adding material to a lot.
 *
 * One decision per screen, each one a grid of pictures. The flow never asks
 * the collector to type anything except a weight, and even that is mostly
 * done with large +/- buttons.
 *
 * Nothing here touches the network. The photo stays on the phone, the value
 * comes from the cached price index, and the lot is written to SQLite before
 * the screen changes.
 */
export function NewLot({ onDone, onCancel }: { onDone: (lot: Lot) => void; onCancel: () => void }) {
  const { t, tc, language, district, collectorId } = useApp();
  const valuer = useValuer();

  const [step, setStep] = useState<Step>('photo');
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [lotId] = useState(() => newLotId());

  const [photoUri, setPhotoUri] = useState<string>();
  const [categoryId, setCategoryId] = useState<MaterialCategoryId>();
  const [sub, setSub] = useState<SubCategory>();
  const [weightKg, setWeightKg] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<MaterialCondition>('intact');
  const [saving, setSaving] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const valuation: Valuation | undefined = useMemo(() => {
    if (!valuer || !sub) return undefined;
    return valuer.estimate({ subCategoryId: sub.id, weightKg, quantity, condition, district });
  }, [valuer, sub, weightKg, quantity, condition, district]);

  const runningTotal = items.reduce((s, i) => s + i.estimatedValueInr, 0) + (valuation?.estimateInr ?? 0);

  async function capture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, skipProcessing: true });
    setPhotoUri(photo?.uri);
    setStep('category');
  }

  function addItem(): MaterialItem | undefined {
    if (!categoryId || !sub || !valuation) return undefined;
    const item: MaterialItem = {
      materialId: newMaterialId(),
      lotId,
      categoryId,
      subCategoryId: sub.id,
      description: '',
      imageRefs: photoUri ? [photoUri] : [],
      approxWeightKg: weightKg,
      unit: sub.unit,
      quantity,
      condition,
      sourceType: 'household',
      estimatedValueInr: valuation.estimateInr,
      classificationSource: 'collector',
      createdAt: new Date().toISOString(),
    };
    setItems((current) => [...current, item]);
    return item;
  }

  function resetForNextItem() {
    setPhotoUri(undefined);
    setCategoryId(undefined);
    setSub(undefined);
    setWeightKg(1);
    setQuantity(1);
    setCondition('intact');
    setStep('photo');
  }

  async function finish() {
    const last = addItem();
    const all = last ? [...items, last] : items;
    if (all.length === 0) return;
    setSaving(true);

    // Location is requested here, not at startup: asking for GPS before the
    // collector has done anything is how permission prompts get denied.
    //
    // Bounded, because the comment below is only true if it is. A fix indoors,
    // in a basement or with GPS switched off can take a very long time or
    // never arrive, and this sits between the collector tapping "find a buyer"
    // and anything appearing. Blocking a sale on a satellite is the wrong
    // trade every time.
    const point = await withTimeout(readLocation(), LOCATION_TIMEOUT_MS);

    const now = new Date().toISOString();
    const lot: Lot = {
      lotId,
      collectorId,
      status: 'ready',
      items: all,
      totalWeightKg: round2(all.reduce((s, i) => s + i.approxWeightKg, 0)),
      estimatedValueInr: round2(all.reduce((s, i) => s + i.estimatedValueInr, 0)),
      collectionPlace: { locality: '', district, state: '', point },
      collectedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await saveLot(lot);
    setSaving(false);
    onDone(lot);
  }

  /* ------------------------------ steps ------------------------------ */

  if (step === 'photo') {
    return (
      <Screen title={t('lot.photo_prompt')} onBack={onCancel}>
        {!permission?.granted ? (
          <Card>
            {/* This was showing the phone-number privacy line, which says
                nothing about the camera and mentions payments instead. */}
            <Muted>{t('lot.photo_why')}</Muted>
            <PrimaryButton glyph="📷" label={t('action.take_photo')} onPress={() => void requestPermission()} />
            {/* A photo makes the record provable, but refusing the camera must
                not lock the collector out of recording material. The label says
                what the button does rather than a bare "Next". */}
            <PrimaryButton
              tone="neutral"
              label={t('lot.photo_skip')}
              onPress={() => setStep('category')}
            />
          </Card>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
            <Pressable style={styles.shutter} onPress={() => void capture()} accessibilityLabel={t('action.take_photo')}>
              <Text style={{ fontSize: 34 }}>📷</Text>
            </Pressable>
          </View>
        )}
        {items.length > 0 && <Muted>{`${items.length} · ${formatInr(runningTotal)}`}</Muted>}
      </Screen>
    );
  }

  if (step === 'category') {
    return (
      <Screen title={t('lot.pick_category')} onBack={() => setStep('photo')}>
        {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} /> : null}
        <View style={styles.grid}>
          {MATERIAL_CATEGORIES.map((category) => (
            <PictureTile
              key={category.id}
              glyph={category.glyph}
              label={t(category.labelKey as Parameters<typeof t>[0])}
              accent={categoryColors[category.colorToken]}
              selected={categoryId === category.id}
              onPress={() => {
                setCategoryId(category.id);
                void speak(t(category.labelKey as Parameters<typeof t>[0]), language);
                setStep('subcategory');
              }}
            />
          ))}
        </View>
      </Screen>
    );
  }

  if (step === 'subcategory' && categoryId) {
    const category = getCategory(categoryId);
    return (
      <Screen title={t('lot.pick_subcategory')} onBack={() => setStep('category')}>
        <View style={styles.grid}>
          {category.subCategories.map((option) => (
            <PictureTile
              key={option.id}
              glyph={option.glyph}
              label={t(option.labelKey as Parameters<typeof t>[0])}
              selected={sub?.id === option.id}
              onPress={() => {
                setSub(option);
                setStep('weight');
              }}
            />
          ))}
        </View>

        {/* Hazard guidance appears the moment the material is chosen, not in a
            menu the collector would have to go looking for. */}
        <SafetyHint categoryId={categoryId} />
      </Screen>
    );
  }

  if (step === 'weight' && sub) {
    return (
      <Screen title={t('lot.enter_weight')} onBack={() => setStep('subcategory')}>
        <Card>
          <View style={styles.weightRow}>
            <StepperButton label="−" onPress={() => setWeightKg((w) => Math.max(0.1, round1(w - stepFor(w))))} />
            <View style={styles.weightValue}>
              <Text style={styles.weightNumber}>{weightKg < 10 ? weightKg.toFixed(1) : Math.round(weightKg)}</Text>
              <Text style={[type.body, { color: colors.textMuted }]}>{t('lot.weight_unit_kg')}</Text>
            </View>
            <StepperButton label="+" onPress={() => setWeightKg((w) => round1(w + stepFor(w)))} />
          </View>

          <View style={styles.quickRow}>
            {[1, 5, 10, 25, 50].map((preset) => (
              <Pressable key={preset} style={styles.quickChip} onPress={() => setWeightKg(preset)}>
                <Text style={type.small}>{preset}</Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {sub.typicalPieceWeightKg ? (
          <Card>
            <Text style={[type.body, { color: colors.text }]}>{t('lot.how_many')}</Text>
            <View style={styles.weightRow}>
              <StepperButton label="−" onPress={() => setQuantity((q) => Math.max(1, q - 1))} />
              <View style={styles.weightValue}>
                <Text style={styles.weightNumber}>{quantity}</Text>
              </View>
              <StepperButton label="+" onPress={() => setQuantity((q) => q + 1)} />
            </View>
          </Card>
        ) : null}

        <PrimaryButton label={t('action.next')} onPress={() => setStep('condition')} />
      </Screen>
    );
  }

  if (step === 'condition') {
    return (
      <Screen title={t('lot.pick_condition')} onBack={() => setStep('weight')}>
        <View style={styles.grid}>
          {CONDITIONS.map((option) => (
            <PictureTile
              key={option.id}
              glyph={option.glyph}
              label={t(`condition.${option.id}` as Parameters<typeof t>[0])}
              selected={condition === option.id}
              onPress={() => {
                setCondition(option.id);
                setStep('estimate');
              }}
            />
          ))}
        </View>
        {condition === 'burnt' && (
          <Banner tone="danger">
            <Text style={[type.body, { color: colors.danger }]}>{t('safety.no_burning.title')}</Text>
            <Text style={[type.small, { color: colors.danger }]}>{t('safety.no_burning.body')}</Text>
          </Banner>
        )}
      </Screen>
    );
  }

  // estimate
  return (
    <Screen
      title={t('lot.estimate_title')}
      speakText={valuation ? speakEstimate(language, valuation.lowInr, valuation.highInr) : undefined}
      onBack={() => setStep('condition')}
      footer={
        <>
          <PrimaryButton
            glyph={saving ? '⏳' : '✅'}
            label={saving ? t('action.save') : t('lot.finish')}
            onPress={() => void finish()}
            disabled={saving || !valuation}
          />
          <PrimaryButton
            tone="neutral"
            glyph="➕"
            label={t('lot.add_another')}
            onPress={() => {
              addItem();
              resetForNextItem();
            }}
            disabled={saving || !valuation}
          />
        </>
      }
    >
      {!valuation ? (
        <Banner tone="warn">
          <Text style={type.body}>{t('sync.offline')}</Text>
        </Banner>
      ) : (
        <>
          <Card style={{ alignItems: 'center' }}>
            <Text style={[type.body, { color: colors.textMuted }]}>{t('lot.estimate_title')}</Text>
            <Text style={styles.hero}>{formatInr(valuation.estimateInr)}</Text>
            <Text style={[type.body, { color: colors.textMuted }]}>
              {t('lot.estimate_range', {
                low: formatInr(valuation.lowInr),
                high: formatInr(valuation.highInr),
              })}
            </Text>
            {/* Confidence is shown as words, not a number: "0.32" means nothing
                at a weighing scale, "this is a rough guess" does. */}
            {valuation.confidence < 0.45 && (
              <Text style={[type.small, { color: colors.warn }]}>{t('lot.estimate_rough')}</Text>
            )}
          </Card>

          <Card>
            {valuation.reasons.map((coded) => (
              <Text key={coded} style={[type.small, { color: colors.textMuted }]}>
                • {tc(coded)}
              </Text>
            ))}
          </Card>

          {items.length > 0 && (
            <Card>
              <Text style={[type.body, { color: colors.text }]}>{`${items.length + 1} · ${formatInr(runningTotal)}`}</Text>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

function SafetyHint({ categoryId }: { categoryId: MaterialCategoryId }) {
  const { t } = useApp();
  const card = safetyCardsFor([categoryId]).find((c) => c.kind === 'stop');
  if (!card) return null;
  return (
    <Banner tone="danger">
      <Text style={[type.body, { color: colors.danger }]}>
        {card.glyph} {t(card.titleKey as Parameters<typeof t>[0])}
      </Text>
      <Text style={[type.small, { color: colors.danger }]}>{t(card.bodyKey as Parameters<typeof t>[0])}</Text>
    </Banner>
  );
}

function StepperButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <Text style={styles.stepperLabel}>{label}</Text>
    </Pressable>
  );
}

/** Coarser steps as the number grows: 0.1 kg precision is meaningless at 50 kg. */
function stepFor(weight: number): number {
  if (weight < 2) return 0.1;
  if (weight < 10) return 0.5;
  if (weight < 50) return 1;
  return 5;
}

/** Long enough for a warm fix, short enough not to strand someone at a scale. */
const LOCATION_TIMEOUT_MS = 6000;

async function readLocation(): Promise<GeoPoint | undefined> {
  try {
    const permissionResult = await Location.requestForegroundPermissionsAsync();
    if (!permissionResult.granted) return undefined;
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracyM: position.coords.accuracy ?? undefined,
    };
  } catch {
    // A lot without a fix is still a lot. Traceability degrades; the sale does not.
    return undefined;
  }
}

/** Resolves undefined rather than rejecting: the caller must carry on either way. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Photo hash for the traceability record, computed on device. */
export function hashPhotoUri(uri: string, takenAt: string): string {
  return sha256Hex(`${uri}:${takenAt}`).slice(0, 12);
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preview: { width: '100%', height: 150, borderRadius: radius.md, resizeMode: 'cover' },
  cameraWrap: { height: 420, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
  camera: { flex: 1 },
  shutter: {
    position: 'absolute',
    bottom: spacing.lg,
    alignSelf: 'center',
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  weightValue: { flex: 1, alignItems: 'center' },
  weightNumber: { fontSize: 54, fontWeight: '800', color: colors.text },
  stepper: {
    width: TOUCH_MIN + 14,
    height: TOUCH_MIN + 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperLabel: { fontSize: 38, color: colors.primaryText, fontWeight: '700', lineHeight: 42 },
  quickRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between', marginTop: spacing.sm },
  quickChip: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { fontSize: 46, fontWeight: '800', color: colors.money },
});
