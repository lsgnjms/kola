import { createHash } from "node:crypto";
import { httpAuthTemplate } from "@kola/shared";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "../env.js";
import { buildServer } from "../server.js";
import type { DecodedInvoice, PaymentResult, WalletProvider, WalletTransaction } from "../wallet/WalletProvider.js";
import type { FastifyInstance } from "fastify";

const NOW = 1_700_000_000_000;
const PUBLIC = "http://localhost:5173/api";
const HASH = "ab".repeat(32);

/** In-memory wallet: scripted decode/pay results, records payments. */
class FakeWallet implements WalletProvider {
  balanceSat = 500_000;
  decoded: DecodedInvoice = { paymentHash: HASH, amountSat: 1000, expiresAtMs: NOW + 600_000, network: "regtest" };
  payResult: PaymentResult = { status: "succeeded", paymentHash: HASH, feeSat: 1, preimage: "cd".repeat(32) };
  paid: string[] = [];
  history: WalletTransaction[] = [];

  createHoldInvoice = () => Promise.reject(new Error("not used"));
  settleHoldInvoice = () => Promise.reject(new Error("not used"));
  cancelHoldInvoice = () => Promise.reject(new Error("not used"));
  lookupInvoiceState = () => Promise.reject(new Error("not used"));
  subscribeInvoice = () => () => {};
  lookupPayment = async () => null;

  async createInvoice(input: { amountSat: number }) {
    return { paymentRequest: `lnbcrt${input.amountSat}n1fake`, paymentHash: HASH };
  }
  async decodeInvoice(pr: string) {
    if (!pr.startsWith("ln")) throw new Error("bad");
    return this.decoded;
  }
  async payInvoice(input: { paymentRequest: string }) {
    this.paid.push(input.paymentRequest);
    return this.payResult;
  }
  async getBalanceSat() {
    return { localSat: this.balanceSat, remoteSat: 0 };
  }
  async listPayments() {
    return this.history.filter((t) => t.direction === "out");
  }
  async listReceived() {
    return this.history.filter((t) => t.direction === "in");
  }
}

let app: FastifyInstance;
let wallets: Record<string, FakeWallet>;
const alice = generateSecretKey();
const bob = generateSecretKey();

beforeEach(async () => {
  wallets = { alice: new FakeWallet(), bob: new FakeWallet() };
  const env = loadEnv({
    LOG_LEVEL: "fatal",
    DB_PATH: ":memory:",
    MEMBER_NODES: "alice=https://localhost:8082,bob=https://localhost:8083",
    MAX_PAYMENT_SAT: "10000",
    MAX_DAILY_SPEND_SAT: "20000",
  });
  app = await buildServer(env, {
    nowMs: () => NOW,
    walletLoader: async (node) => {
      const w = wallets[node.name];
      if (!w) throw new Error("down");
      return w;
    },
  });
});

afterEach(async () => {
  await app.close();
});

/** Sends a NIP-98 signed request, the way the web app will. */
function call(sk: Uint8Array, method: "GET" | "POST", path: string, body?: unknown, opts: { nowS?: number } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const event = finalizeEvent(
    httpAuthTemplate({
      url: PUBLIC + path,
      method,
      nowS: opts.nowS ?? NOW / 1000,
      ...(payload ? { payloadSha256Hex: createHash("sha256").update(payload).digest("hex") } : {}),
    }),
    sk,
  );
  const authorization = `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
  return {
    authorization,
    send: (headers: Record<string, string> = {}) =>
      app.inject({
        method,
        url: path,
        headers: { authorization, ...(payload ? { "content-type": "application/json" } : {}), ...headers },
        ...(payload ? { payload } : {}),
      }),
  };
}

describe("auth", () => {
  it("rejects unsigned requests", async () => {
    const res = await app.inject({ method: "GET", url: "/wallet/balance" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects replayed signatures", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    const req = call(alice, "GET", "/wallet/balance");
    expect((await req.send()).statusCode).toBe(200);
    expect((await req.send()).statusCode).toBe(401);
  });

  it("rejects a body that doesn't match the signed payload", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    const signed = call(alice, "POST", "/wallet/invoices", { amountSat: 100 });
    const res = await app.inject({
      method: "POST",
      url: "/wallet/invoices",
      headers: { authorization: signed.authorization, "content-type": "application/json" },
      payload: JSON.stringify({ amountSat: 9999 }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects stale signatures", async () => {
    const res = await call(alice, "GET", "/wallet/balance", undefined, { nowS: NOW / 1000 - 120 }).send();
    expect(res.statusCode).toBe(401);
  });
});

describe("wallet routes", () => {
  it("requires a claimed wallet, then serves balance", async () => {
    expect((await call(alice, "GET", "/wallet/balance").send()).statusCode).toBe(404);
    expect((await call(alice, "POST", "/wallet/claim").send()).statusCode).toBe(200);
    const res = await call(alice, "GET", "/wallet/balance").send();
    expect(res.json()).toEqual({ balanceSat: 500_000 });
  });

  it("gives each member their own wallet and runs out when nodes are taken", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    await call(bob, "POST", "/wallet/claim").send();
    wallet("bob").balanceSat = 42;
    expect((await call(bob, "GET", "/wallet/balance").send()).json()).toEqual({ balanceSat: 42 });
    expect((await call(alice, "GET", "/wallet/balance").send()).json()).toEqual({ balanceSat: 500_000 });
    expect((await call(generateSecretKey(), "POST", "/wallet/claim").send()).statusCode).toBe(409);
  });

  it("creates invoices within the cap and validates input", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    const ok = await call(alice, "POST", "/wallet/invoices", { amountSat: 500 }).send();
    expect(ok.json()).toMatchObject({ paymentRequest: "lnbcrt500n1fake" });
    expect((await call(alice, "POST", "/wallet/invoices", { amountSat: 10_001 }).send()).statusCode).toBe(400);
    expect((await call(alice, "POST", "/wallet/invoices", { amountSat: 1.5 }).send()).statusCode).toBe(400);
    expect((await call(alice, "POST", "/wallet/invoices", { amountSat: 5, memo: "x" }).send()).statusCode).toBe(400);
  });

  it("pays a valid invoice", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    const res = await call(alice, "POST", "/wallet/pay", { paymentRequest: "lnbcrt10u1x" }).send();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "succeeded", amountSat: 1000, feeSat: 1 });
    expect(wallet("alice").paid).toEqual(["lnbcrt10u1x"]);
  });

  it("refuses wrong-network invoices without moving money", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    wallet("alice").decoded = { ...wallet("alice").decoded, network: "mainnet" };
    const res = await call(alice, "POST", "/wallet/pay", { paymentRequest: "lnbc10u1x" }).send();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "wrong_network", moneyMoved: false });
    expect(wallet("alice").paid).toEqual([]);
  });

  it("enforces the daily cap from the wallet's own history", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    wallet("alice").history = [
      { direction: "out", paymentHash: HASH, amountSat: 19_500, feeSat: 0, status: "complete", timestampMs: NOW - 1000 },
    ];
    const res = await call(alice, "POST", "/wallet/pay", { paymentRequest: "lnbcrt10u1x" }).send();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "over_daily_cap", moneyMoved: false });
  });

  it("reports failed payments plainly", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    wallet("alice").payResult = { status: "failed", paymentHash: HASH, reason: "FAILURE_REASON_NO_ROUTE" };
    const res = await call(alice, "POST", "/wallet/pay", { paymentRequest: "lnbcrt10u1x" }).send();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "payment_failed", moneyMoved: false });
  });

  it("returns merged history without payment hashes", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    wallet("alice").history = [
      { direction: "out", paymentHash: HASH, amountSat: 10, feeSat: 1, status: "complete", timestampMs: NOW - 2000 },
      { direction: "in", paymentHash: HASH, amountSat: 20, feeSat: 0, status: "complete", timestampMs: NOW - 1000 },
    ];
    const res = await call(alice, "GET", "/wallet/history").send();
    expect(res.json()).toEqual({
      transactions: [
        { direction: "in", amountSat: 20, feeSat: 0, status: "complete", timestampMs: NOW - 1000 },
        { direction: "out", amountSat: 10, feeSat: 1, status: "complete", timestampMs: NOW - 2000 },
      ],
    });
  });

  it("says the wallet is unavailable when its node is down", async () => {
    await call(alice, "POST", "/wallet/claim").send();
    delete wallets.alice;
    const res = await call(alice, "GET", "/wallet/balance").send();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "wallet_unavailable", moneyMoved: false });
  });
});

function wallet(name: string): FakeWallet {
  const w = wallets[name];
  if (!w) throw new Error(`no fake wallet ${name}`);
  return w;
}
