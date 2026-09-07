import * as Speech from 'expo-speech';
import { ttsLocale, type LanguageCode } from '@ewaste/shared';

/**
 * Text to speech.
 *
 * Marathi and Hindi voices are not present on every entry-level Android build.
 * Rather than failing silently - which would leave a user who cannot read with
 * nothing at all - we fall back through Hindi to the device default and report
 * what happened, so the UI can show the written form more prominently when
 * speech is unavailable.
 */
let available: Set<string> | undefined;

async function loadVoices(): Promise<Set<string>> {
  if (available) return available;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    available = new Set(voices.map((v) => v.language));
  } catch {
    available = new Set();
  }
  return available;
}

export async function speak(text: string, language: LanguageCode): Promise<void> {
  if (!text) return;
  Speech.stop();
  const voices = await loadVoices();
  const preferred = ttsLocale(language);
  // mr-IN -> hi-IN is a real fallback: a Marathi speaker can follow Hindi far
  // better than they can follow an English voice reading Devanagari.
  const chain = language === 'mr' ? [preferred, 'hi-IN', 'en-IN'] : [preferred, 'en-IN'];
  const chosen = chain.find((tag) => voices.has(tag)) ?? undefined;

  Speech.speak(text, {
    language: chosen,
    rate: 0.92, // slightly slow: prices and codes are read once and acted on
    pitch: 1.0,
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}

/** True when the device can speak this language at all. */
export async function canSpeak(language: LanguageCode): Promise<boolean> {
  const voices = await loadVoices();
  if (voices.size === 0) return true; // unknown; assume the platform default works
  const chain = language === 'mr' ? [ttsLocale(language), 'hi-IN'] : [ttsLocale(language)];
  return chain.some((tag) => voices.has(tag));
}
