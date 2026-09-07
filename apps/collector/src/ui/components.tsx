import { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, spacing, TOUCH_MIN, type } from './theme.ts';
import { speak } from '../audio/tts.ts';
import { useApp } from '../state/AppContext.tsx';

/**
 * A screen with a title that is always readable aloud. The speaker button is
 * part of the header, not an accessibility afterthought, because for a good
 * share of users it is the primary way to read the screen.
 */
export function Screen({
  title,
  speakText,
  onBack,
  children,
  footer,
}: {
  title: string;
  speakText?: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { language } = useApp();
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {onBack && (
          <Pressable onPress={onBack} style={styles.backBtn} accessibilityLabel="Back" hitSlop={12}>
            <Text style={styles.backGlyph}>←</Text>
          </Pressable>
        )}
        <Text style={[type.heading, styles.headerTitle]} numberOfLines={2}>
          {title}
        </Text>
        <SpeakButton text={speakText ?? title} language={language} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

export function SpeakButton({ text, language }: { text: string; language: 'mr' | 'hi' | 'en' }) {
  return (
    <Pressable
      onPress={() => speak(text, language)}
      style={styles.speakBtn}
      accessibilityLabel="Listen"
      hitSlop={10}
    >
      <Text style={styles.speakGlyph}>🔊</Text>
    </Pressable>
  );
}

/** The main action on a screen. One per screen, at the bottom, full width. */
export function PrimaryButton({
  label,
  glyph,
  onPress,
  disabled,
  tone = 'primary',
}: {
  label: string;
  glyph?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'neutral';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryBtn,
        tone === 'neutral' && styles.neutralBtn,
        disabled && styles.disabledBtn,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {glyph ? <Text style={styles.primaryGlyph}>{glyph}</Text> : null}
      <Text style={[type.body, tone === 'primary' ? styles.primaryLabel : styles.neutralLabel]}>{label}</Text>
    </Pressable>
  );
}

/** A big pictorial choice - the core interaction of the whole app. */
export function PictureTile({
  glyph,
  label,
  sublabel,
  accent,
  selected,
  onPress,
  style,
}: {
  glyph: string;
  label: string;
  sublabel?: string;
  accent?: string;
  selected?: boolean;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        accent ? { borderColor: accent } : null,
        selected && { borderColor: colors.primary, borderWidth: 3, backgroundColor: colors.okBg },
        pressed && styles.pressed,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.tileGlyph}>{glyph}</Text>
      <Text style={[type.small, styles.tileLabel]} numberOfLines={2}>
        {label}
      </Text>
      {sublabel ? (
        <Text style={[styles.tileSub]} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Banner({ tone, children }: { tone: 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  const toneStyle =
    tone === 'ok' ? styles.bannerOk : tone === 'warn' ? styles.bannerWarn : styles.bannerDanger;
  return <View style={[styles.banner, toneStyle]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={[type.small, { color: colors.textMuted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { flex: 1, color: colors.text },
  backBtn: {
    width: TOUCH_MIN - 8,
    height: TOUCH_MIN - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  backGlyph: { fontSize: 26, color: colors.text },
  speakBtn: {
    width: TOUCH_MIN - 8,
    height: TOUCH_MIN - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  speakGlyph: { fontSize: 24 },
  scrollBody: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    gap: spacing.sm,
  },
  primaryBtn: {
    minHeight: TOUCH_MIN + 8,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  neutralBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  disabledBtn: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  primaryGlyph: { fontSize: 22 },
  primaryLabel: { color: colors.primaryText },
  neutralLabel: { color: colors.text },
  tile: {
    minHeight: 118,
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    gap: spacing.xs,
  },
  tileGlyph: { fontSize: 40 },
  tileLabel: { color: colors.text, textAlign: 'center' },
  tileSub: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  banner: { borderRadius: radius.md, padding: spacing.md },
  bannerOk: { backgroundColor: colors.okBg },
  bannerWarn: { backgroundColor: colors.warnBg },
  bannerDanger: { backgroundColor: colors.dangerBg },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
});

export { styles as uiStyles };
