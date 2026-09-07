import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGUAGES, type LanguageCode } from '@ewaste/shared';
import { colors, radius, spacing, TOUCH_MIN, type } from '../ui/theme.ts';
import { speak } from '../audio/tts.ts';

/**
 * First screen, first run. No text the user must be able to read: each option
 * is written in its own script and speaks itself when touched, so picking a
 * language never depends on already understanding the app's language.
 */
export function Onboarding({ onPick }: { onPick: (language: LanguageCode) => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>♻️</Text>
      <Text style={[type.title, styles.heading]}>भाषा · भाषा · Language</Text>

      <View style={styles.options}>
        {LANGUAGES.map((option) => (
          <Pressable
            key={option.code}
            style={({ pressed }) => [styles.option, pressed && { opacity: 0.75 }]}
            onPress={() => {
              // Speak the choice before committing, so a wrong tap is obvious.
              void speak(option.nativeName, option.code);
              onPick(option.code);
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'center', gap: spacing.lg },
  logo: { fontSize: 64, textAlign: 'center' },
  heading: { textAlign: 'center', color: colors.text },
  options: { gap: spacing.md },
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
});
