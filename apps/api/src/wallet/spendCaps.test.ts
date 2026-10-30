import { describe, expect, it } from "vitest";
import { checkSpend, feeLimitSat, KeyedMutex, spentSat } from "./spendCaps.js";
import type { WalletTransaction } from "./WalletProvider.js";

const tx = (o: Partial<WalletTransaction>): WalletTransaction => ({
  direction: "out",
  paymentHash: "a".repeat(64),
  amountSat: 1000,
  feeSat: 1,
  status: "complete",
  timestampMs: 1000,
  ...o,
});

describe("spentSat", () => {
  it("counts completed and pending outgoing payments in the window, with fees", () => {
    const txs = [
      tx({}),
      tx({ status: "pending" }),
      tx({ status: "failed" }),
      tx({ direction: "in" }),
      tx({ timestampMs: 999 }),
    ];
    expect(spentSat(txs, 1000)).toBe(2002);
  });
});

describe("checkSpend", () => {
  const caps = { maxPaymentSat: 10_000, maxDailySat: 20_000 };

  it("allows payments within both caps", () => {
    expect(checkSpend({ amountSat: 10_000, feeLimitSat: 100, spentLast24hSat: 9_900, caps })).toEqual({ ok: true });
  });

  it("rejects over the per-payment cap", () => {
    expect(checkSpend({ amountSat: 10_001, feeLimitSat: 0, spentLast24hSat: 0, caps })).toMatchObject({
      reason: "over_payment_cap",
    });
  });

  it("counts the worst-case fee against the daily cap", () => {
    expect(checkSpend({ amountSat: 10_000, feeLimitSat: 101, spentLast24hSat: 9_900, caps })).toMatchObject({
      reason: "over_daily_cap",
    });
  });
});

describe("feeLimitSat", () => {
  it("is 1% with a floor", () => {
    expect(feeLimitSat(100)).toBe(10);
    expect(feeLimitSat(50_000)).toBe(500);
  });
});

describe("KeyedMutex", () => {
  it("runs same-key tasks one at a time, even when one fails", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    const task = (name: string, fail = false) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`${name}:end`);
      if (fail) throw new Error(name);
    };
    await Promise.allSettled([mutex.run("k", task("a", true)), mutex.run("k", task("b"))]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });
});
