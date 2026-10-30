import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LndRestWallet } from "./LndRestWallet.js";
import { LndError, type HttpMethod, type LndTransport } from "./transport.js";

type Handler = (body: unknown) => unknown;
type StreamScript = { messages?: unknown[]; error?: Error };

/** Scripted LND: responses keyed by "METHOD path". Records every call. */
class FakeTransport implements LndTransport {
  calls: { method: HttpMethod; path: string; body?: unknown }[] = [];
  closed = 0;

  constructor(
    private readonly routes: Record<string, Handler> = {},
    private readonly streams: Record<string, StreamScript> = {},
  ) {}

  async request(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    this.calls.push({ method, path, body });
    const handler = this.routes[`${method} ${path}`];
    if (!handler) throw new LndError(404, `no route ${method} ${path}`);
    return handler(body);
  }

  stream(
    method: HttpMethod,
    path: string,
    body: unknown,
    h: { onMessage: (m: unknown) => void; onError: (e: Error) => void; onEnd: () => void },
  ): () => void {
    this.calls.push({ method, path, body });
    const script = this.streams[`${method} ${path}`];
    if (!script) throw new Error(`no stream ${method} ${path}`);
    // Deliver synchronously to exercise the early-finish path.
    for (const m of script.messages ?? []) h.onMessage(m);
    if (script.error) h.onError(script.error);
    else h.onEnd();
    return () => {
      this.closed++;
    };
  }
}

const PREIMAGE = "11".repeat(32);
const HASH = createHash("sha256").update(Buffer.from(PREIMAGE, "hex")).digest("hex");
const HASH_B64 = Buffer.from(HASH, "hex").toString("base64");
// LND wants URL-safe base64 WITH padding in paths (verified against LND 0.18 REST).
const HASH_B64URL = `${Buffer.from(HASH, "hex").toString("base64url")}=`;
const PAYREQ = "lnbcrt10u1pexample";

const fail = () => {
  throw new LndError(500, "boom");
};

describe("hold invoices", () => {
  it("creates a hold invoice with base64 hash and string int64s", async () => {
    const invoices = new FakeTransport({ "POST /v2/invoices/hodl": () => ({ payment_request: PAYREQ }) });
    const wallet = new LndRestWallet(invoices, new FakeTransport());

    const res = await wallet.createHoldInvoice({
      paymentHash: HASH,
      amountSat: 10_000,
      expirySeconds: 600,
      cltvExpiryDelta: 80,
      memo: "Kola cycle 1",
    });

    expect(res.paymentRequest).toBe(PAYREQ);
    expect(invoices.calls[0]?.body).toEqual({
      hash: HASH_B64,
      value: "10000",
      expiry: "600",
      cltv_expiry: "80",
      memo: "Kola cycle 1",
    });
  });

  it("settle is idempotent when the invoice is already settled", async () => {
    const invoices = new FakeTransport({
      "POST /v2/invoices/settle": fail,
      [`GET /v1/invoice/${HASH}`]: () => ({ state: "SETTLED" }),
    });
    await expect(new LndRestWallet(invoices, new FakeTransport()).settleHoldInvoice(PREIMAGE)).resolves.toBeUndefined();
  });

  it("settle surfaces the error when the invoice is not settled", async () => {
    const invoices = new FakeTransport({
      "POST /v2/invoices/settle": fail,
      [`GET /v1/invoice/${HASH}`]: () => ({ state: "CANCELED" }),
    });
    await expect(new LndRestWallet(invoices, new FakeTransport()).settleHoldInvoice(PREIMAGE)).rejects.toThrow("boom");
  });

  it("cancel is idempotent but never hides a settled invoice", async () => {
    const cancelled = new FakeTransport({
      "POST /v2/invoices/cancel": fail,
      [`GET /v1/invoice/${HASH}`]: () => ({ state: "CANCELED" }),
    });
    await expect(new LndRestWallet(cancelled, new FakeTransport()).cancelHoldInvoice(HASH)).resolves.toBeUndefined();

    const settled = new FakeTransport({
      "POST /v2/invoices/cancel": fail,
      [`GET /v1/invoice/${HASH}`]: () => ({ state: "SETTLED" }),
    });
    await expect(new LndRestWallet(settled, new FakeTransport()).cancelHoldInvoice(HASH)).rejects.toThrow("boom");
  });

  it("rejects malformed preimages and hashes before calling LND", async () => {
    const invoices = new FakeTransport();
    const wallet = new LndRestWallet(invoices, new FakeTransport());
    await expect(wallet.settleHoldInvoice("../../etc")).rejects.toThrow();
    await expect(wallet.lookupInvoiceState("not-a-hash")).rejects.toThrow();
    expect(invoices.calls).toHaveLength(0);
  });

  it("treats a missing state field as OPEN", async () => {
    const invoices = new FakeTransport({ [`GET /v1/invoice/${HASH}`]: () => ({}) });
    await expect(new LndRestWallet(invoices, new FakeTransport()).lookupInvoiceState(HASH)).resolves.toBe("OPEN");
  });

  it("streams invoice states and reports the end of the stream as an error", () => {
    const invoices = new FakeTransport({}, {
      [`GET /v2/invoices/subscribe/${HASH_B64URL}`]: { messages: [{ state: "OPEN" }, { state: "ACCEPTED" }] },
    });
    const states: string[] = [];
    const errors: string[] = [];
    new LndRestWallet(invoices, new FakeTransport()).subscribeInvoice(HASH, {
      onState: (s) => states.push(s),
      onError: (e) => errors.push(e.message),
    });
    expect(states).toEqual(["OPEN", "ACCEPTED"]);
    expect(errors).toEqual(["invoice subscription ended"]);
  });
});

describe("decodeInvoice", () => {
  it("returns amount, expiry and network", async () => {
    const payments = new FakeTransport({
      [`GET /v1/payreq/${PAYREQ}`]: () => ({
        payment_hash: HASH,
        num_msat: "1000000",
        timestamp: "1700000000",
        expiry: "3600",
      }),
    });
    const decoded = await new LndRestWallet(new FakeTransport(), payments).decodeInvoice(PAYREQ);
    expect(decoded).toEqual({
      paymentHash: HASH,
      amountSat: 1000,
      expiresAtMs: 1_700_003_600_000,
      network: "regtest",
    });
  });

  it("rejects sub-sat amounts and non-bolt11 input", async () => {
    const payments = new FakeTransport({
      [`GET /v1/payreq/${PAYREQ}`]: () => ({ payment_hash: HASH, num_msat: "1500", timestamp: "1", expiry: "1" }),
    });
    const wallet = new LndRestWallet(new FakeTransport(), payments);
    await expect(wallet.decodeInvoice(PAYREQ)).rejects.toThrow(/whole number of sats/);
    await expect(wallet.decodeInvoice("lnbcrt1/../../v1/balance")).rejects.toThrow();
  });
});

describe("payments", () => {
  const trackPath = `GET /v2/router/track/${HASH_B64URL}`;
  const notInitiated = new LndError(500, "payment isn't initiated");

  it("does not pay twice when a payment already succeeded", async () => {
    const payments = new FakeTransport({}, {
      [trackPath]: { messages: [{ payment_hash: HASH, status: "SUCCEEDED", fee_sat: "2", payment_preimage: PREIMAGE }] },
    });
    const res = await new LndRestWallet(new FakeTransport(), payments).payInvoice({
      paymentRequest: PAYREQ,
      paymentHash: HASH,
      maxFeeSat: 50,
      timeoutSeconds: 30,
    });
    expect(res).toEqual({ status: "succeeded", paymentHash: HASH, feeSat: 2, preimage: PREIMAGE });
    expect(payments.calls.map((c) => c.path)).not.toContain("/v2/router/send");
  });

  it("pays when no previous attempt exists and waits for a terminal status", async () => {
    const payments = new FakeTransport({}, {
      [trackPath]: { error: notInitiated },
      "POST /v2/router/send": {
        messages: [
          { payment_hash: HASH, status: "IN_FLIGHT" },
          { payment_hash: HASH, status: "SUCCEEDED", fee_sat: "1", payment_preimage: PREIMAGE },
        ],
      },
    });
    const res = await new LndRestWallet(new FakeTransport(), payments).payInvoice({
      paymentRequest: PAYREQ,
      paymentHash: HASH,
      maxFeeSat: 50,
      timeoutSeconds: 30,
    });
    expect(res).toEqual({ status: "succeeded", paymentHash: HASH, feeSat: 1, preimage: PREIMAGE });
    const send = payments.calls.find((c) => c.path === "/v2/router/send");
    expect(send?.body).toMatchObject({ payment_request: PAYREQ, fee_limit_sat: "50", timeout_seconds: 30 });
    expect(payments.closed).toBeGreaterThan(0);
  });

  it("reports in_flight if the send stream ends without a result", async () => {
    const payments = new FakeTransport({}, {
      [trackPath]: { error: notInitiated },
      "POST /v2/router/send": { messages: [] },
    });
    const res = await new LndRestWallet(new FakeTransport(), payments).payInvoice({
      paymentRequest: PAYREQ,
      paymentHash: HASH,
      maxFeeSat: 50,
      timeoutSeconds: 30,
    });
    expect(res.status).toBe("in_flight");
  });

  it("maps failures with LND's reason", async () => {
    const payments = new FakeTransport({}, {
      [trackPath]: { messages: [{ payment_hash: HASH, status: "FAILED", failure_reason: "FAILURE_REASON_NO_ROUTE" }] },
    });
    await expect(new LndRestWallet(new FakeTransport(), payments).lookupPayment(HASH)).resolves.toEqual({
      status: "failed",
      paymentHash: HASH,
      reason: "FAILURE_REASON_NO_ROUTE",
    });
  });

  it("propagates unexpected tracking errors", async () => {
    const payments = new FakeTransport({}, { [trackPath]: { error: new LndError(500, "database locked") } });
    await expect(new LndRestWallet(new FakeTransport(), payments).lookupPayment(HASH)).rejects.toThrow("database locked");
  });
});

describe("getBalanceSat", () => {
  it("reads channel balances, defaulting missing fields to zero", async () => {
    const payments = new FakeTransport({
      "GET /v1/balance/channels": () => ({ local_balance: { sat: "990000" } }),
    });
    await expect(new LndRestWallet(new FakeTransport(), payments).getBalanceSat()).resolves.toEqual({
      localSat: 990_000,
      remoteSat: 0,
    });
  });
});
