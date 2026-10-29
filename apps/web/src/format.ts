import type { ClientErrorCode } from "./api/client.js";
import type { Locale, MessageKey, Translate } from "./i18n/index.js";

export function formatSat(locale: Locale, amountSat: number): string {
  return new Intl.NumberFormat(locale).format(amountSat);
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
