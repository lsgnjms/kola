import { createContext, useContext } from "react";
import en from "./en.json";
import fr from "./fr.json";

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/** English is the reference catalogue; other locales must have the same keys. */
export type MessageKey = keyof typeof en;

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { en, fr };

/** Looks up a message and fills `{name}` placeholders. */
export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  return CATALOGUES[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function detectLocale(): Locale {
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nContext");
  return ctx;
}
