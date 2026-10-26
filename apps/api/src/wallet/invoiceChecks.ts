import type { DecodedInvoice, Network } from "./WalletProvider.js";

/**
 * Network from the BOLT11 human-readable prefix. Longer prefixes first:
 * "lnbcrt" (regtest) also starts with "lnbc" (mainnet), "lntbs" with "lntb".
 */
const PREFIXES: [string, Network][] = [
  ["lnbcrt", "regtest"],
  ["lntbs", "signet"],
  ["lntb", "testnet"],
  ["lnbc", "mainnet"],
];

export function networkFromBolt11(paymentRequest: string): Network | null {
  const lower = paymentRequest.trim().toLowerCase();
  for (const [prefix, network] of PREFIXES) {
    if (lower.startsWith(prefix)) return network;
  }
  return null;
}

export type InvoiceCheckFailure =
  | "wrong_network"
  | "no_amount"
  | "wrong_amount"
  | "over_limit"
  | "expired";

/**
 * Checks a decoded invoice before any payment. Pure, so it is unit-tested
 * without LND. `expectedAmountSat` is required for payouts (must equal the pot).
 */
export function checkInvoiceBeforePay(
  invoice: DecodedInvoice,
  rules: {
    network: Network;
    nowMs: number;
    maxAmountSat: number;
    expectedAmountSat?: number;
    /** Reject invoices expiring sooner than this, so the payment has time to complete. */
    minRemainingMs?: number;
  },
): { ok: true } | { ok: false; reason: InvoiceCheckFailure } {
  if (invoice.network !== rules.network) return { ok: false, reason: "wrong_network" };
  if (invoice.amountSat <= 0) return { ok: false, reason: "no_amount" };
  if (rules.expectedAmountSat !== undefined && invoice.amountSat !== rules.expectedAmountSat) {
    return { ok: false, reason: "wrong_amount" };
  }
  if (invoice.amountSat > rules.maxAmountSat) return { ok: false, reason: "over_limit" };
  if (invoice.expiresAtMs - rules.nowMs < (rules.minRemainingMs ?? 0)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}
