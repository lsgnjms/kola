import type { HoldInvoiceState, PaymentHashHex } from "@kola/shared";

/**
 * All Lightning access goes through this interface (LND REST now, NWC later).
 * Routes never talk to LND directly. Implementations must make settle, cancel
 * and pay idempotent: repeating a call for the same payment hash is a no-op
 * once it has succeeded.
 */
export interface WalletProvider {
  /** Creates a hold invoice for a hash whose preimage the coordinator keeps secret. */
  createHoldInvoice(input: {
    paymentHash: PaymentHashHex;
    amountSat: number;
    expirySeconds: number;
    cltvExpiryDelta: number;
    memo: string;
  }): Promise<{ paymentRequest: string }>;

  settleHoldInvoice(preimageHex: string): Promise<void>;
  cancelHoldInvoice(paymentHash: PaymentHashHex): Promise<void>;
  lookupInvoiceState(paymentHash: PaymentHashHex): Promise<HoldInvoiceState>;

  /** Streams state changes for one invoice. Returns an unsubscribe function. */
  subscribeInvoice(
    paymentHash: PaymentHashHex,
    onState: (state: HoldInvoiceState) => void,
  ): () => void;

  /** Decodes a BOLT11 invoice. Callers check amount, expiry and network before paying. */
  decodeInvoice(paymentRequest: string): Promise<DecodedInvoice>;

  payInvoice(input: { paymentRequest: string; maxFeeSat: number }): Promise<PaymentResult>;
  lookupPayment(paymentHash: PaymentHashHex): Promise<PaymentResult | null>;
}

export interface DecodedInvoice {
  paymentHash: PaymentHashHex;
  amountSat: number;
  expiresAtMs: number;
  network: "regtest" | "testnet" | "signet" | "mainnet";
}

export type PaymentResult =
  | { status: "succeeded"; paymentHash: PaymentHashHex; feeSat: number }
  | { status: "in_flight"; paymentHash: PaymentHashHex }
  | { status: "failed"; paymentHash: PaymentHashHex; reason: string };
