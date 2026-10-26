import type { WalletTransaction } from "./WalletProvider.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface SpendCaps {
  maxPaymentSat: number;
  maxDailySat: number;
}

/** Routing fee limit for member payments: 1% with a 10 sat floor. */
export function feeLimitSat(amountSat: number): number {
  return Math.max(10, Math.ceil(amountSat / 100));
}

/**
 * Sats spent in the window, counted from LND's own payment history (the source
 * of truth, so caps survive API restarts). In-flight payments count: their
 * money may already be gone.
 */
export function spentSat(payments: readonly WalletTransaction[], sinceMs: number): number {
  return payments
    .filter((p) => p.direction === "out" && p.status !== "failed" && p.timestampMs >= sinceMs)
    .reduce((sum, p) => sum + p.amountSat + p.feeSat, 0);
}

/** Worst case for a new payment is amount plus the full fee limit. */
export function checkSpend(input: {
  amountSat: number;
  feeLimitSat: number;
  spentLast24hSat: number;
  caps: SpendCaps;
}): { ok: true } | { ok: false; reason: "over_payment_cap" | "over_daily_cap" } {
  if (input.amountSat > input.caps.maxPaymentSat) return { ok: false, reason: "over_payment_cap" };
  if (input.spentLast24hSat + input.amountSat + input.feeLimitSat > input.caps.maxDailySat) {
    return { ok: false, reason: "over_daily_cap" };
  }
  return { ok: true };
}

/** Serializes work per key (one payment at a time per wallet) so caps can't be raced. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
