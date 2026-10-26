import en from "./en.json";
import fr from "./fr.json";

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/** English is the reference catalogue; other locales must have the same keys. */
export type MessageKey = keyof typeof en;

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { en, fr };

export function t(locale: Locale, key: MessageKey): string {
  return CATALOGUES[locale][key];
}

export function detectLocale(): Locale {
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}
