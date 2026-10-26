import { createHash } from "node:crypto";
import { HoldInvoiceState, PaymentHashHex } from "@kola/shared";
import { z } from "zod";
import { networkFromBolt11 } from "../invoiceChecks.js";
import type { DecodedInvoice, PaymentResult, WalletProvider, WalletTransaction } from "../WalletProvider.js";
import { LndError, type HttpMethod, type LndTransport } from "./transport.js";

/**
 * WalletProvider backed by LND's REST API.
 *
 * Least privilege: two transports with different macaroons (baked by the seed script).
 * - `invoices`: create/settle/cancel/lookup/subscribe invoices. Can't send money.
 * - `payments`: decode, send and track payments, read channel balance. Can't open
 *   or close channels or touch on-chain funds.
 */
export class LndRestWallet implements WalletProvider {
  constructor(
    private readonly invoices: LndTransport,
    private readonly payments: LndTransport,
  ) {}

  async createHoldInvoice(input: {
    paymentHash: PaymentHashHex;
    amountSat: number;
    expirySeconds: number;
    cltvExpiryDelta: number;
    memo: string;
  }): Promise<{ paymentRequest: string }> {
    const res = AddHoldInvoiceResponse.parse(
      await this.invoices.request("POST", "/v2/invoices/hodl", {
        hash: hexToBase64(PaymentHashHex.parse(input.paymentHash)),
        value: String(input.amountSat),
        expiry: String(input.expirySeconds),
        cltv_expiry: String(input.cltvExpiryDelta),
        memo: input.memo,
      }),
    );
    return { paymentRequest: res.payment_request };
  }

  async settleHoldInvoice(preimageHex: string): Promise<void> {
    const preimage = Preimage.parse(preimageHex);
    const paymentHash = sha256Hex(preimage);
    try {
      await this.invoices.request("POST", "/v2/invoices/settle", { preimage: hexToBase64(preimage) });
    } catch (err) {
      // Idempotent: a retry after a successful settle is fine.
      if ((await this.lookupInvoiceState(paymentHash)) === "SETTLED") return;
      throw err;
    }
  }

  async cancelHoldInvoice(paymentHash: PaymentHashHex): Promise<void> {
    try {
      await this.invoices.request("POST", "/v2/invoices/cancel", {
        payment_hash: hexToBase64(PaymentHashHex.parse(paymentHash)),
      });
    } catch (err) {
      // Idempotent for CANCELED; a SETTLED invoice can't be cancelled and must surface.
      if ((await this.lookupInvoiceState(paymentHash)) === "CANCELED") return;
      throw err;
    }
  }

  async lookupInvoiceState(paymentHash: PaymentHashHex): Promise<HoldInvoiceState> {
    const res = InvoiceResponse.parse(
      await this.invoices.request("GET", `/v1/invoice/${PaymentHashHex.parse(paymentHash)}`),
    );
    return res.state;
  }

  subscribeInvoice(
    paymentHash: PaymentHashHex,
    handlers: { onState: (state: HoldInvoiceState) => void; onError: (err: Error) => void },
  ): () => void {
    const path = `/v2/invoices/subscribe/${hexToBase64Url(PaymentHashHex.parse(paymentHash))}`;
    return this.invoices.stream("GET", path, undefined, {
      onMessage: (msg) => {
        const parsed = InvoiceResponse.safeParse(msg);
        if (parsed.success) handlers.onState(parsed.data.state);
        else handlers.onError(new Error("unexpected invoice update from LND"));
      },
      onError: handlers.onError,
      // The engine resubscribes; an ended stream is never a terminal state on its own.
      onEnd: () => handlers.onError(new Error("invoice subscription ended")),
    });
  }

  async createInvoice(input: {
    amountSat: number;
    expirySeconds: number;
    memo: string;
  }): Promise<{ paymentRequest: string; paymentHash: PaymentHashHex }> {
    const res = AddInvoiceResponse.parse(
      await this.invoices.request("POST", "/v1/invoices", {
        value: String(input.amountSat),
        expiry: String(input.expirySeconds),
        memo: input.memo,
      }),
    );
    return {
      paymentRequest: res.payment_request,
      paymentHash: PaymentHashHex.parse(Buffer.from(res.r_hash, "base64").toString("hex")),
    };
  }

  async decodeInvoice(paymentRequest: string): Promise<DecodedInvoice> {
    const pr = Bolt11.parse(paymentRequest.trim());
    const network = networkFromBolt11(pr);
    if (!network) throw new Error("unrecognised invoice network");
    const res = DecodePayReqResponse.parse(await this.payments.request("GET", `/v1/payreq/${pr}`));
    if (res.num_msat % 1000 !== 0) throw new Error("invoice amount is not a whole number of sats");
    return {
      paymentHash: res.payment_hash,
      amountSat: res.num_msat / 1000,
      expiresAtMs: (res.timestamp + res.expiry) * 1000,
      network,
    };
  }

  async payInvoice(input: {
    paymentRequest: string;
    paymentHash: PaymentHashHex;
    maxFeeSat: number;
    timeoutSeconds: number;
  }): Promise<PaymentResult> {
    // Idempotent: never start a second attempt while one succeeded or is in flight.
    const existing = await this.lookupPayment(input.paymentHash);
    if (existing && existing.status !== "failed") return existing;

    const msg = await firstMessage(
      this.payments,
      "POST",
      "/v2/router/send",
      {
        payment_request: Bolt11.parse(input.paymentRequest.trim()),
        timeout_seconds: input.timeoutSeconds,
        fee_limit_sat: String(input.maxFeeSat),
        no_inflight_updates: true,
      },
      (m) => {
        const status = PaymentUpdate.safeParse(m);
        return status.success && (status.data.status === "SUCCEEDED" || status.data.status === "FAILED");
      },
    );
    if (msg === null) return { status: "in_flight", paymentHash: input.paymentHash };
    return toPaymentResult(PaymentUpdate.parse(msg));
  }

  async lookupPayment(paymentHash: PaymentHashHex): Promise<PaymentResult | null> {
    const path = `/v2/router/track/${hexToBase64Url(PaymentHashHex.parse(paymentHash))}`;
    try {
      const msg = await firstMessage(this.payments, "GET", path, undefined, () => true);
      return msg === null ? null : toPaymentResult(PaymentUpdate.parse(msg));
    } catch (err) {
      // LND reports an unknown hash as an error rather than an empty result.
      if (err instanceof LndError && /not initiated|isn't initiated/i.test(err.message)) return null;
      throw err;
    }
  }

  async getBalanceSat(): Promise<{ localSat: number; remoteSat: number }> {
    const res = ChannelBalanceResponse.parse(await this.payments.request("GET", "/v1/balance/channels"));
    return { localSat: res.local_balance.sat, remoteSat: res.remote_balance.sat };
  }

  async listPayments(input: { sinceMs: number; limit: number }): Promise<WalletTransaction[]> {
    const query = new URLSearchParams({
      include_incomplete: "true",
      reversed: "true",
      max_payments: String(input.limit),
      creation_date_start: String(Math.floor(input.sinceMs / 1000)),
    });
    const res = ListPaymentsResponse.parse(await this.payments.request("GET", `/v1/payments?${query}`));
    return res.payments.map((p) => ({
      direction: "out",
      paymentHash: p.payment_hash,
      amountSat: p.value_sat,
      feeSat: p.fee_sat,
      status: p.status === "SUCCEEDED" ? "complete" : p.status === "FAILED" ? "failed" : "pending",
      timestampMs: p.creation_time_ns,
    }));
  }

  async listReceived(input: { limit: number }): Promise<WalletTransaction[]> {
    const query = new URLSearchParams({ reversed: "true", num_max_invoices: String(input.limit) });
    const res = ListInvoicesResponse.parse(await this.invoices.request("GET", `/v1/invoices?${query}`));
    return res.invoices
      .filter((i) => i.state === "SETTLED")
      .map((i) => ({
        direction: "in",
        paymentHash: PaymentHashHex.parse(Buffer.from(i.r_hash, "base64").toString("hex")),
        amountSat: i.amt_paid_sat,
        feeSat: 0,
        status: "complete",
        timestampMs: i.settle_date * 1000,
      }));
  }
}

/** Resolves with the first stream message matching `accept`, or null if the stream ends first. */
function firstMessage(
  transport: LndTransport,
  method: HttpMethod,
  path: string,
  body: unknown,
  accept: (msg: unknown) => boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false;
    let close = () => {};
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      close();
      fn();
    };
    close = transport.stream(method, path, body, {
      onMessage: (msg) => {
        if (accept(msg)) finish(() => resolve(msg));
      },
      onError: (err) => finish(() => reject(err)),
      onEnd: () => finish(() => resolve(null)),
    });
    // The stream may have finished synchronously, before `close` was assigned.
    if (done) close();
  });
}

function toPaymentResult(p: z.infer<typeof PaymentUpdate>): PaymentResult {
  switch (p.status) {
    case "SUCCEEDED":
      return { status: "succeeded", paymentHash: p.payment_hash, feeSat: p.fee_sat };
    case "FAILED":
      return { status: "failed", paymentHash: p.payment_hash, reason: p.failure_reason };
    default:
      return { status: "in_flight", paymentHash: p.payment_hash };
  }
}

function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

function hexToBase64Url(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64url");
}

function sha256Hex(hex: string): PaymentHashHex {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

// --- LND response schemas (external input: validate, don't trust) ---

/** LND encodes int64 as JSON strings. */
const Int = z.union([z.string(), z.number()]).pipe(z.coerce.number().int().nonnegative().safe());

const Preimage = z.string().regex(/^[0-9a-f]{64}$/);
/** bech32 charset only, so it is safe to put in a URL path. */
const Bolt11 = z.string().regex(/^ln[0-9a-z]+$/i).max(4096);

const AddHoldInvoiceResponse = z.object({ payment_request: z.string() });
const AddInvoiceResponse = z.object({ payment_request: z.string(), r_hash: z.string() });
const InvoiceResponse = z.object({ state: HoldInvoiceState.default("OPEN") });

const DecodePayReqResponse = z.object({
  payment_hash: PaymentHashHex,
  num_msat: Int.default(0),
  timestamp: Int,
  expiry: Int,
});

const PaymentUpdate = z.object({
  payment_hash: PaymentHashHex,
  status: z.enum(["UNKNOWN", "IN_FLIGHT", "SUCCEEDED", "FAILED", "INITIATED"]),
  fee_sat: Int.default(0),
  failure_reason: z.string().default("FAILURE_REASON_NONE"),
});

/** Nanosecond timestamps exceed Number.MAX_SAFE_INTEGER; truncate to ms on the string. */
const NsToMs = z
  .string()
  .regex(/^\d+$/)
  .transform((ns) => (ns.length > 6 ? Number(ns.slice(0, -6)) : 0));

const ListPaymentsResponse = z.object({
  payments: z
    .array(
      z.object({
        payment_hash: PaymentHashHex,
        value_sat: Int.default(0),
        fee_sat: Int.default(0),
        status: z.enum(["UNKNOWN", "IN_FLIGHT", "SUCCEEDED", "FAILED", "INITIATED"]),
        creation_time_ns: NsToMs,
      }),
    )
    .default([]),
});

const ListInvoicesResponse = z.object({
  invoices: z
    .array(
      z.object({
        r_hash: z.string(),
        amt_paid_sat: Int.default(0),
        state: HoldInvoiceState.default("OPEN"),
        settle_date: Int.default(0),
      }),
    )
    .default([]),
});

const ChannelBalanceResponse = z.object({
  local_balance: z.object({ sat: Int.default(0) }).default({}),
  remote_balance: z.object({ sat: Int.default(0) }).default({}),
});
