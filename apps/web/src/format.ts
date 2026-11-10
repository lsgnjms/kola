import type { FiatCurrency } from "@kola/shared";
import type { ClientErrorCode } from "./api/client.js";
import type { Locale, MessageKey, Translate } from "./i18n/index.js";

export function formatSat(locale: Locale, amountSat: number): string {
  return new Intl.NumberFormat(locale).format(amountSat);
}

const SAT_PER_BTC = 100_000_000;

/**
 * "≈ 4,343 F CFA" for an amount in sats, or null when there is no rate or the
 * value is under one unit. Display only: the float never feeds a money decision.
 */
export function formatFiat(locale: Locale, amountSat: number, currency: FiatCurrency, btcPrice: number | undefined): string | null {
  if (!btcPrice || !Number.isFinite(btcPrice) || btcPrice <= 0) return null;
  const value = (amountSat * btcPrice) / SAT_PER_BTC;
  if (value < 1) return null;
  // FCFA is written after the number in every locale ("4 345 FCFA"); the naira sign goes first ("₦10,000").
  const money =
    currency === "XOF"
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} FCFA`
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          currencyDisplay: "narrowSymbol",
          maximumFractionDigits: 0,
        }).format(value);
  return `≈ ${money}`;
}

export function formatTime(locale: Locale, timestampMs: number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(timestampMs);
}

/**
 * Plain-language error, plus a sentence on whether money moved when the
 * failure happened during a payment.
 */
export function describeError(t: Translate, code: ClientErrorCode, moneyMoved?: boolean | null): string[] {
  const lines = [t(`errors.${code}` as MessageKey)];
  if (moneyMoved === false) lines.push(t("errors.moneyStill"));
  if (moneyMoved === null) lines.push(t("errors.moneyUnknown"));
  return lines;
}
