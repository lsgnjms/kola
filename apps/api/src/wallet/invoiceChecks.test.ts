import { describe, expect, it } from "vitest";
import { checkInvoiceBeforePay, networkFromBolt11 } from "./invoiceChecks.js";
import type { DecodedInvoice } from "./WalletProvider.js";

describe("networkFromBolt11", () => {
  it("distinguishes overlapping prefixes", () => {
    expect(networkFromBolt11("lnbcrt10u1p...")).toBe("regtest");
    expect(networkFromBolt11("lnbc10u1p...")).toBe("mainnet");
    expect(networkFromBolt11("lntbs10u1p...")).toBe("signet");
    expect(networkFromBolt11("lntb10u1p...")).toBe("testnet");
    expect(networkFromBolt11("LNBCRT10U1P...")).toBe("regtest");
    expect(networkFromBolt11("bitcoin:bc1q...")).toBeNull();
  });
});

describe("checkInvoiceBeforePay", () => {
  const now = 1_700_000_000_000;
  const invoice: DecodedInvoice = {
    paymentHash: "a".repeat(64),
    amountSat: 30_000,
    expiresAtMs: now + 600_000,
    network: "regtest",
  };
  const rules = { network: "regtest" as const, nowMs: now, maxAmountSat: 100_000 };

  it("accepts a valid invoice", () => {
    expect(checkInvoiceBeforePay(invoice, rules)).toEqual({ ok: true });
  });

  it("rejects mainnet invoices on regtest", () => {
    expect(checkInvoiceBeforePay({ ...invoice, network: "mainnet" }, rules)).toEqual({
      ok: false,
      reason: "wrong_network",
    });
  });

  it("rejects amount-less invoices", () => {
    expect(checkInvoiceBeforePay({ ...invoice, amountSat: 0 }, rules)).toMatchObject({ reason: "no_amount" });
  });

  it("requires the payout amount to equal the pot exactly", () => {
    expect(checkInvoiceBeforePay(invoice, { ...rules, expectedAmountSat: 30_000 })).toEqual({ ok: true });
    expect(checkInvoiceBeforePay(invoice, { ...rules, expectedAmountSat: 29_999 })).toMatchObject({
      reason: "wrong_amount",
    });
  });

  it("enforces the per-payment cap", () => {
    expect(checkInvoiceBeforePay(invoice, { ...rules, maxAmountSat: 10_000 })).toMatchObject({ reason: "over_limit" });
  });

  it("rejects expired or nearly expired invoices", () => {
    expect(checkInvoiceBeforePay({ ...invoice, expiresAtMs: now - 1 }, rules)).toMatchObject({ reason: "expired" });
    expect(checkInvoiceBeforePay(invoice, { ...rules, minRemainingMs: 900_000 })).toMatchObject({ reason: "expired" });
  });
});
