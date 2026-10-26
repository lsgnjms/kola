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

  /** Settles the hold invoice for sha256(preimage). Succeeds if it was already settled. */
  settleHoldInvoice(preimageHex: string): Promise<void>;
  /** Cancels a hold invoice. Succeeds if it was already cancelled; throws if it was settled. */
  cancelHoldInvoice(paymentHash: PaymentHashHex): Promise<void>;
  lookupInvoiceState(paymentHash: PaymentHashHex): Promise<HoldInvoiceState>;

  /** Streams state changes for one invoice. Returns an unsubscribe function. */
  subscribeInvoice(
    paymentHash: PaymentHashHex,
    handlers: { onState: (state: HoldInvoiceState) => void; onError: (err: Error) => void },
  ): () => void;

  /** Regular (non-hold) invoice, e.g. a member receiving into their wallet or a payout invoice. */
  createInvoice(input: {
    amountSat: number;
    expirySeconds: number;
    memo: string;
  }): Promise<{ paymentRequest: string; paymentHash: PaymentHashHex }>;

  /** Decodes a BOLT11 invoice. Callers check it with `checkInvoiceBeforePay` before paying. */
  decodeInvoice(paymentRequest: string): Promise<DecodedInvoice>;

  /** Pays an invoice. Returns the existing result instead of paying twice. */
  payInvoice(input: {
    paymentRequest: string;
    paymentHash: PaymentHashHex;
    maxFeeSat: number;
    timeoutSeconds: number;
  }): Promise<PaymentResult>;
  lookupPayment(paymentHash: PaymentHashHex): Promise<PaymentResult | null>;

  /** Spendable balance across open channels. */
  getBalanceSat(): Promise<{ localSat: number; remoteSat: number }>;
}

export type Network = "regtest" | "signet" | "testnet" | "mainnet";

export interface DecodedInvoice {
  paymentHash: PaymentHashHex;
  /** 0 for amount-less invoices; callers must reject those. */
  amountSat: number;
  expiresAtMs: number;
  network: Network;
}

export type PaymentResult =
  | { status: "succeeded"; paymentHash: PaymentHashHex; feeSat: number }
  | { status: "in_flight"; paymentHash: PaymentHashHex }
  | { status: "failed"; paymentHash: PaymentHashHex; reason: string };
