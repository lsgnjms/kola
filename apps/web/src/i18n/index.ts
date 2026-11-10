import type { FiatCurrency } from "@kola/shared";
import { createContext, useContext } from "react";
import en from "./en.json";

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/** English is the reference catalogue; other locales must have the same keys. */
export type MessageKey = keyof typeof en;

/**
 * English ships in the first download; other languages are fetched when chosen,
 * which keeps the initial bundle small on slow networks.
 */
const CATALOGUES: Partial<Record<Locale, Record<MessageKey, string>>> = { en };

export async function loadLocale(locale: Locale): Promise<void> {
  if (CATALOGUES[locale]) return;
  if (locale === "fr") CATALOGUES.fr = (await import("./fr.json")).default;
}

/** Looks up a message and fills `{name}` placeholders. Falls back to English until a catalogue loads. */
export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const catalogue = CATALOGUES[locale] ?? en;
  return catalogue[key].replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

const STORAGE_KEY = "kola.locale";

/** The member's earlier choice, else the phone's language. */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    // Storage blocked (private mode): fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not remembered; harmless.
  }
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Which local currency to show next to sats, or none. */
export type CurrencyChoice = FiatCurrency | "off";
export const CURRENCY_CHOICES: CurrencyChoice[] = ["XOF", "NGN", "off"];
const CURRENCY_KEY = "kola.currency";

export function detectCurrency(): CurrencyChoice {
  try {
    const saved = localStorage.getItem(CURRENCY_KEY);
    if (saved === "XOF" || saved === "NGN" || saved === "off") return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return "XOF";
}

export function rememberCurrency(choice: CurrencyChoice): void {
  try {
    localStorage.setItem(CURRENCY_KEY, choice);
  } catch {
    // Not remembered; harmless.
  }
}

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  currency: CurrencyChoice;
  setCurrency: (choice: CurrencyChoice) => void;
  /** "≈ 4,343 F CFA" for an amount, or null (no rate yet, currency off, or too small). */
  fiat: (amountSat: number) => string | null;
}

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nContext");
  return ctx;
}
