import { checkInvoiceBeforePay, type InvoiceCheckFailure } from "./invoiceChecks.js";
import { checkSpend, DAY_MS, feeLimitSat, spentSat, type SpendCaps } from "./spendCaps.js";
import type { Network, WalletProvider } from "./WalletProvider.js";

export type PayError =
  | "invalid_invoice"
  /** `over_limit` is reported as `over_payment_cap`. */
  | Exclude<InvoiceCheckFailure, "over_limit">
  | "over_payment_cap"
  | "over_daily_cap"
  | "payment_failed";

export type PayOutcome =
  | { ok: true; status: "succeeded" | "in_flight"; amountSat: number; feeSat: number }
  /** Every error here means no money left the wallet. */
  | { ok: false; error: PayError };

/** Leave enough time for the payment to route before the invoice expires. */
const MIN_REMAINING_MS = 30_000;
const PAY_TIMEOUT_S = 60;
const HISTORY_LIMIT = 1000;

export interface PayContext {
  network: Network;
  nowMs: number;
  caps: SpendCaps;
  /** When set (e.g. a circle contribution), the invoice must be for exactly this amount. */
  expectedAmountSat?: number;
}

export type PreparedPayment =
  | { ok: true; paymentRequest: string; paymentHash: string; amountSat: number; maxFeeSat: number }
  | { ok: false; error: PayError };

/**
 * Every check before money leaves a member's wallet: decode via LND, check
 * network / amount / expiry, enforce spend caps from LND's own history.
 * Callers must serialize per wallet (KeyedMutex) so caps can't be raced.
 */
export async function preparePayment(
  wallet: WalletProvider,
  paymentRequest: string,
  ctx: PayContext,
): Promise<PreparedPayment> {
  let decoded;
  try {
    decoded = await wallet.decodeInvoice(paymentRequest);
  } catch {
    return { ok: false, error: "invalid_invoice" };
  }

  const check = checkInvoiceBeforePay(decoded, {
    network: ctx.network,
    nowMs: ctx.nowMs,
    maxAmountSat: ctx.caps.maxPaymentSat,
    minRemainingMs: MIN_REMAINING_MS,
    ...(ctx.expectedAmountSat !== undefined ? { expectedAmountSat: ctx.expectedAmountSat } : {}),
  });
  if (!check.ok) return { ok: false, error: check.reason === "over_limit" ? "over_payment_cap" : check.reason };

  const since = ctx.nowMs - DAY_MS;
  const history = await wallet.listPayments({ sinceMs: since, limit: HISTORY_LIMIT });
  const maxFeeSat = feeLimitSat(decoded.amountSat);
  const spend = checkSpend({
    amountSat: decoded.amountSat,
    feeLimitSat: maxFeeSat,
    spentLast24hSat: spentSat(history, since),
    caps: ctx.caps,
  });
  if (!spend.ok) return { ok: false, error: spend.reason };

  return { ok: true, paymentRequest, paymentHash: decoded.paymentHash, amountSat: decoded.amountSat, maxFeeSat };
}

/** Checks, then pays and waits for the result. */
export async function payFromWallet(
  wallet: WalletProvider,
  paymentRequest: string,
  ctx: PayContext,
): Promise<PayOutcome> {
  const prepared = await preparePayment(wallet, paymentRequest, ctx);
  if (!prepared.ok) return prepared;
  const { paymentHash, maxFeeSat } = prepared;

  const result = await wallet.payInvoice({
    paymentRequest,
    paymentHash,
    maxFeeSat,
    timeoutSeconds: PAY_TIMEOUT_S,
  });
  switch (result.status) {
    case "succeeded":
      return { ok: true, status: "succeeded", amountSat: prepared.amountSat, feeSat: result.feeSat };
    case "in_flight":
      return { ok: true, status: "in_flight", amountSat: prepared.amountSat, feeSat: 0 };
    case "failed":
      return { ok: false, error: "payment_failed" };
  }
}
