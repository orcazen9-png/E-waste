import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  LANGUAGES,
  isPlausibleIndianMobile,
  t as translate,
  type LanguageCode,
  type TranslationKey,
} from '@ewaste/shared';
import { colors, radius, spacing, TOUCH_MIN, type } from '../ui/theme.ts';
import { speak } from '../audio/tts.ts';
import { useApp } from '../state/AppContext.tsx';
import { OfflineError } from '../api/client.ts';

/**
 * First run: language, then phone, then code.
 *
 * The language screen carries no text the user must be able to read - each
 * option is written in its own script and speaks itself when touched, so
 * choosing a language never depends on already understanding the app's
 * language.
 *
 * Sign-in is the one step that needs connectivity, and the screen says so.
 * Everything after this works offline; putting the network dependency here,
 * once, is the trade that keeps the rest of the app usable in a dead zone.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { setLanguage, requestSignInCode, completeSignIn, enterDemoMode } = useApp();
  const [language, setLocal] = useState<LanguageCode>();
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string>();
  const [devCode, setDevCode] = useState<string>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const t = (key: TranslationKey, values?: Record<string, string | number>) =>
    translate(language ?? 'mr', key, values);

  if (!language) {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>♻️</Text>
        <Text style={[type.title, styles.heading]}>भाषा · भाषा · Language</Text>

        <View style={{ gap: spacing.md }}>
          {LANGUAGES.map((option) => (
            <Pressable
              key={option.code}
              style={({ pressed }) => [styles.option, pressed && { opacity: 0.75 }]}
              onPress={() => {
                void speak(option.nativeName, option.code);
                void setLanguage(option.code);
                setLocal(option.code);
              }}
              accessibilityRole="button"
              accessibilityLabel={option.nativeName}
            >
              <Text style={styles.optionGlyph}>{option.glyph}</Text>
              <Text style={styles.optionText}>{option.nativeName}</Text>
              <Text style={styles.speaker}>🔊</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.note}>ओळखपत्र नको · पहचान पत्र नहीं · No ID needed</Text>
      </View>
    );
  }

  async function sendCode() {
    if (!isPlausibleIndianMobile(phone)) {
      setError(t('auth.invalid_phone'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await requestSignInCode(phone);
      setChallengeId(result.challengeId);
      setDevCode(result.devCode);
    } catch (e) {
      setError(describe(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!challengeId) return;
    setBusy(true);
    setError(undefined);
    try {
      await completeSignIn({ challengeId, code, phone });
      onDone();
    } catch (e) {
      setError(describe(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>{challengeId ? '🔢' : '📱'}</Text>

      {!challengeId ? (
        <>
          <Text style={[type.title, styles.heading]}>{t('onboarding.phone_prompt')}</Text>
          <Text style={styles.note}>{t('onboarding.phone_why')}</Text>

          <TextInput
            style={styles.bigInput}
            value={phone}
            onChangeText={(value) => setPhone(value.replace(/\D/g, '').slice(0, 10))}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="__________"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('onboarding.phone_prompt')}
          />

          <Pressable
            style={({ pressed }) => [styles.cta, (busy || phone.length < 10) && styles.ctaDisabled, pressed && { opacity: 0.8 }]}
            onPress={() => void sendCode()}
            disabled={busy || phone.length < 10}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>{t('onboarding.send_code')}</Text>
          </Pressable>

          <Text style={styles.note}>📶 {t('onboarding.needs_internet')}</Text>
          <Text style={styles.note}>{t('onboarding.no_id_needed')}</Text>

          {/* Signing in is the one step that needs a network. Without this,
              a phone with no signal - or a demo with no server - cannot get
              past this screen at all. */}
          <Pressable
            style={({ pressed }) => [styles.demoBtn, pressed && { opacity: 0.8 }]}
            onPress={async () => {
              await enterDemoMode();
              onDone();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.demoText}>👀 {t('demo.try')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[type.title, styles.heading]}>{t('onboarding.enter_code')}</Text>
          <Text style={styles.note}>{t('onboarding.code_sent')}</Text>

          {/* Development only: with no SMS provider the server hands the code
              back, and hiding it would just make the app untestable. */}
          {devCode ? <Text style={styles.devCode}>{t('onboarding.dev_code', { code: devCode })}</Text> : null}

          <TextInput
            style={styles.bigInput}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="______"
            placeholderTextColor={colors.textMuted}
            autoFocus
            accessibilityLabel={t('onboarding.enter_code')}
          />

          <Pressable
            style={({ pressed }) => [styles.cta, (busy || code.length < 6) && styles.ctaDisabled, pressed && { opacity: 0.8 }]}
            onPress={() => void verify()}
            disabled={busy || code.length < 6}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>{t('action.confirm')}</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setChallengeId(undefined);
              setCode('');
              setDevCode(undefined);
              setError(undefined);
            }}
          >
            <Text style={[styles.note, { textDecorationLine: 'underline' }]}>
              {t('onboarding.change_number')}
            </Text>
          </Pressable>
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/**
 * The server returns translation keys as error codes, so the phone renders the
 * message in the collector's own language. Anything unrecognised is reported
 * as a connection problem rather than shown as a raw code.
 */
const AUTH_ERROR_KEYS = [
  'auth.invalid_phone',
  'auth.invalid_code',
  'auth.code_expired',
  'auth.code_already_used',
  'auth.too_many_attempts',
  'auth.too_many_requests',
  'auth.sms_not_configured',
] as const satisfies readonly TranslationKey[];

function describe(error: unknown, t: (key: TranslationKey) => string): string {
  if (error instanceof OfflineError) return t('auth.no_internet');
  const code = error instanceof Error ? error.message : '';
  const known = AUTH_ERROR_KEYS.find((key) => key === code);
  return known ? t(known) : t('auth.no_internet');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'center', gap: spacing.lg },
  logo: { fontSize: 64, textAlign: 'center' },
  heading: { textAlign: 'center', color: colors.text },
  option: {
    minHeight: TOUCH_MIN + 16,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  optionGlyph: { fontSize: 26 },
  optionText: { flex: 1, fontSize: 26, fontWeight: '700', color: colors.text },
  speaker: { fontSize: 24 },
  note: { textAlign: 'center', color: colors.textMuted, fontSize: 15 },
  bigInput: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  cta: {
    minHeight: TOUCH_MIN + 8,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.primaryText, fontSize: 19, fontWeight: '700' },
  devCode: { textAlign: 'center', color: colors.warn, fontSize: 15, fontWeight: '700' },
  demoBtn: {
    minHeight: TOUCH_MIN,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoText: { fontSize: 17, fontWeight: '600', color: colors.text },
  error: {
    textAlign: 'center',
    color: colors.danger,
    fontSize: 16,
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
});
