import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SAFETY_CARDS } from '@ewaste/shared';
import { Screen } from '../ui/components.tsx';
import { colors, radius, spacing, type } from '../ui/theme.ts';
import { useApp } from '../state/AppContext.tsx';
import { speak } from '../audio/tts.ts';

/**
 * Safety guidance.
 *
 * "Stop" cards come first and are red, because the practices that hurt people
 * - burning cable, acid-stripping boards, cutting batteries - are the ones the
 * platform exists to displace. Every card reads itself aloud; none of them
 * require reading.
 */
export function Safety({ onBack }: { onBack: () => void }) {
  const { t, language } = useApp();
  const ordered = [...SAFETY_CARDS].sort((a, b) => (a.kind === 'stop' ? -1 : 1) - (b.kind === 'stop' ? -1 : 1));

  return (
    <Screen title={t('safety.title')} onBack={onBack}>
      {ordered.map((card) => {
        const title = t(card.titleKey as Parameters<typeof t>[0]);
        const body = t(card.bodyKey as Parameters<typeof t>[0]);
        return (
          <Pressable
            key={card.key}
            style={({ pressed }) => [
              styles.card,
              card.kind === 'stop' ? styles.stop : styles.do,
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => void speak(`${title}. ${body}`, language)}
            accessibilityRole="button"
            accessibilityLabel={title}
          >
            <Text style={styles.glyph}>{card.glyph}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[type.body, { color: card.kind === 'stop' ? colors.danger : colors.text }]}>
                {card.kind === 'stop' ? '🚫 ' : ''}
                {title}
              </Text>
              <Text style={[type.small, { color: colors.textMuted }]}>{body}</Text>
            </View>
            <Text style={styles.speaker}>🔊</Text>
          </Pressable>
        );
      })}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  stop: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  do: { borderColor: colors.border, backgroundColor: colors.surface },
  glyph: { fontSize: 34 },
  speaker: { fontSize: 22 },
});
