import { z } from "zod";

/**
 * Wallet API contract, shared by api (responses) and web (parses responses,
 * maps error codes to plain-language copy).
 */

export const ApiErrorCode = z.enum([
  "unauthorized",
  "invalid_request",
  "rate_limited",
  "internal",
  "no_wallet",
  "no_wallet_available",
  "wallet_unavailable",
  "invalid_invoice",
  "wrong_network",
  "no_amount",
  "wrong_amount",
  "expired",
  "over_payment_cap",
  "over_daily_cap",
  "payment_failed",
  "payment_status_unknown",
  "circle_not_found",
  "not_a_member",
  "not_creator",
  "circle_full",
  "circle_not_ready",
  "cycle_in_progress",
  "circle_complete",
  "no_open_cycle",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorBody = z.object({
  error: ApiErrorCode,
  /** false: no money left the wallet. null: unknown (contact lost mid-payment). Absent: not a payment. */
  moneyMoved: z.boolean().nullable().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const BalanceResponse = z.object({ balanceSat: z.number().int().nonnegative() });
export type BalanceResponse = z.infer<typeof BalanceResponse>;

export const ClaimResponse = z.object({ ready: z.literal(true) });

export const CreateInvoiceResponse = z.object({
  paymentRequest: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type CreateInvoiceResponse = z.infer<typeof CreateInvoiceResponse>;

export const DecodeResponse = z.object({
  amountSat: z.number().int().nonnegative(),
  expiresAtMs: z.number().int(),
});
export type DecodeResponse = z.infer<typeof DecodeResponse>;

export const PayResponse = z.object({
  status: z.enum(["succeeded", "in_flight"]),
  amountSat: z.number().int().nonnegative(),
  feeSat: z.number().int().nonnegative(),
});
export type PayResponse = z.infer<typeof PayResponse>;

export const WalletTransactionView = z.object({
  direction: z.enum(["in", "out"]),
  amountSat: z.number().int().nonnegative(),
  feeSat: z.number().int().nonnegative(),
  status: z.enum(["pending", "complete", "failed"]),
  timestampMs: z.number().int(),
});
export type WalletTransactionView = z.infer<typeof WalletTransactionView>;

export const HistoryResponse = z.object({ transactions: z.array(WalletTransactionView) });
export type HistoryResponse = z.infer<typeof HistoryResponse>;
