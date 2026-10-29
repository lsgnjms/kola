import { createHash, randomBytes } from "node:crypto";
import type { HoldInvoiceState } from "@kola/shared";
import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db.js";
import type { DecodedInvoice, PaymentResult, WalletProvider } from "../wallet/WalletProvider.js";
import { CycleEngine, EngineError, type EngineDeps } from "./engine.js";
import { derivePreimage } from "./preimage.js";
import type { CircleEvent } from "./publisher.js";
import { CircleStore } from "./store.js";

const sha256 = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const MEMBERS = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const CONTRIBUTION = 10_000;
const POT = CONTRIBUTION * 3;
const WINDOW_MS = 300_000;

/** In-memory LND with real hold-invoice semantics. */
class FakeLnd implements WalletProvider {
  invoices = new Map<string, { state: HoldInvoiceState; amountSat: number }>();
  listeners = new Map<string, (s: HoldInvoiceState) => void>();
  /** Off = simulate a crashed/disconnected engine that misses updates. */
  notify = true;
  payoutInvoices = new Map<string, DecodedInvoice>();
  payResults: PaymentResult["status"][] = [];
  payments = new Map<string, PaymentResult>();
  payCalls = 0;
  cancelCalls = 0;

  async createHoldInvoice(i: { paymentHash: string; amountSat: number }) {
    if (this.invoices.has(i.paymentHash)) throw new Error("invoice with payment hash already exists");
    this.invoices.set(i.paymentHash, { state: "OPEN", amountSat: i.amountSat });
    return { paymentRequest: `lnbcrt-hold-${i.paymentHash}` };
  }
  /** A member's payment arrives and is held. */
  hold(hash: string) {
    this.set(hash, "ACCEPTED");
  }
  async settleHoldInvoice(preimage: string) {
    const inv = this.invoices.get(sha256(preimage));
    if (!inv || (inv.state !== "ACCEPTED" && inv.state !== "SETTLED")) throw new Error("not held");
    this.set(sha256(preimage), "SETTLED");
  }
  async cancelHoldInvoice(hash: string) {
    this.cancelCalls++;
    const inv = this.invoices.get(hash);
    if (!inv) throw new Error("unknown invoice");
    if (inv.state === "SETTLED") throw new Error("invoice already settled");
    this.set(hash, "CANCELED");
  }
  async lookupInvoiceState(hash: string) {
    const inv = this.invoices.get(hash);
    if (!inv) throw new Error("unknown invoice");
    return inv.state;
  }
  subscribeInvoice(hash: string, h: { onState: (s: HoldInvoiceState) => void }) {
    this.listeners.set(hash, h.onState);
    return () => this.listeners.delete(hash);
  }
  async createInvoice(): Promise<never> {
    throw new Error("not used");
  }
  async decodeInvoice(pr: string) {
    const d = this.payoutInvoices.get(pr);
    if (!d) throw new Error("bad invoice");
    return d;
  }
  async payInvoice(i: { paymentHash: string }) {
    this.payCalls++;
    const existing = this.payments.get(i.paymentHash);
    if (existing?.status === "succeeded") return existing;
    const status = this.payResults.shift() ?? "succeeded";
    const result: PaymentResult =
      status === "succeeded"
        ? { status, paymentHash: i.paymentHash, feeSat: 1 }
        : status === "failed"
          ? { status, paymentHash: i.paymentHash, reason: "FAILURE_REASON_NO_ROUTE" }
          : { status, paymentHash: i.paymentHash };
    this.payments.set(i.paymentHash, result);
    return result;
  }
  async lookupPayment(hash: string) {
    return this.payments.get(hash) ?? null;
  }
  async getBalanceSat() {
    return { localSat: 0, remoteSat: 0 };
  }
  async listPayments() {
    return [];
  }
  async listReceived() {
    return [];
  }

  private set(hash: string, state: HoldInvoiceState) {
    const inv = this.invoices.get(hash);
    if (!inv) throw new Error("unknown invoice");
    inv.state = state;
    if (this.notify) this.listeners.get(hash)?.(state);
  }
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} } as unknown as FastifyBaseLogger;

let lnd: FakeLnd;
let store: CircleStore;
let now: number;
let events: CircleEvent[];
let secret: Buffer;
let payoutAmount: number;

function makeEngine(overrides: Partial<EngineDeps> = {}) {
  return new CycleEngine({
    store,
    coordinator: async () => lnd,
    payoutInvoice: async (recipient, amountSat) => {
      const pr = `lnbcrt-payout-${recipient.slice(0, 4)}-${lnd.payoutInvoices.size}`;
      lnd.payoutInvoices.set(pr, {
        paymentHash: randomBytes(32).toString("hex"),
        amountSat: payoutAmount || amountSat,
        expiresAtMs: now + 600_000,
        network: "regtest",
      });
      return pr;
    },
    publisher: { publish: async (e) => void events.push(e) },
    preimageSecret: secret,
    network: "regtest",
    nowMs: () => now,
    log: silentLog,
    config: {
      contributionWindowMs: WINDOW_MS,
      cltvExpiryDelta: 80,
      maxPayoutFeeSat: 50,
      payoutRetryBaseMs: 5_000,
      payoutRetryMaxMs: 60_000,
    },
    ...overrides,
  });
}

function activeCircle(): string {
  const id = "11111111-1111-4111-8111-111111111111";
  store.createCircle({
    id,
    name: "Test",
    contributionSat: CONTRIBUTION,
    memberCount: 3,
    periodSeconds: 604800,
    creatorPubkey: MEMBERS[0] ?? "",
    joinCode: "ABCDEF",
    status: "active",
    createdAtMs: now,
  });
  MEMBERS.forEach((m, i) => store.addMember(id, m, `M${i}`, now));
  return id;
}

const hashes = (circleId: string) => {
  const cycle = store.latestCycle(circleId);
  if (!cycle) throw new Error("no cycle");
  return store.contributions(cycle).map((c) => c.paymentHash);
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  lnd = new FakeLnd();
  store = new CircleStore(openDb(":memory:"));
  now = 1_700_000_000_000;
  events = [];
  secret = randomBytes(32);
  payoutAmount = 0;
});

describe("CycleEngine", () => {
  it("happy path: all hold, all settle, pot paid to the rotation's recipient", async () => {
    const circleId = activeCircle();
    const engine = makeEngine();

    const cycle = await engine.openNextCycle(circleId);
    expect(cycle).toMatchObject({ state: "collecting", cycleIndex: 0, attempt: 1, recipientPubkey: MEMBERS[0] });
    // Hashes come from derived preimages, so nothing secret needs storing.
    expect(hashes(circleId)[0]).toBe(
      sha256(derivePreimage(secret, { circleId, cycleIndex: 0, attempt: 1, memberPubkey: MEMBERS[0] ?? "" })),
    );

    for (const h of hashes(circleId)) lnd.hold(h);
    await flush();

    expect(store.latestCycle(circleId)?.state).toBe("paid_out");
    expect([...lnd.invoices.values()].map((i) => i.state)).toEqual(["SETTLED", "SETTLED", "SETTLED"]);
    expect(events.map((e) => e.type)).toEqual([
      "cycle_opened",
      "contribution_held",
      "contribution_held",
      "contribution_held",
      "contribution_settled",
      "contribution_settled",
      "contribution_settled",
      "payout_sent",
    ]);
    expect(events.at(-1)).toMatchObject({ recipient: MEMBERS[0], amountSat: POT });

    const next = await engine.openNextCycle(circleId);
    expect(next).toMatchObject({ cycleIndex: 1, recipientPubkey: MEMBERS[1] });
  });

  it("missed deadline: everyone refunded, the round reopens with fresh invoices", async () => {
    const circleId = activeCircle();
    const engine = makeEngine();
    await engine.openNextCycle(circleId);
    const [h0, h1] = hashes(circleId);
    lnd.hold(h0 ?? "");
    lnd.hold(h1 ?? "");
    await flush();

    now += WINDOW_MS;
    await engine.tick();

    expect(store.latestCycle(circleId)?.state).toBe("cancelled");
    expect([...lnd.invoices.values()].every((i) => i.state === "CANCELED")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "cycle_cancelled", missing: [MEMBERS[2]] });

    const retry = await engine.openNextCycle(circleId);
    expect(retry).toMatchObject({ cycleIndex: 0, attempt: 2, recipientPubkey: MEMBERS[0] });
    expect(hashes(circleId)).not.toContain(h0);
  });

  it("only one round at a time, and only once the circle is full", async () => {
    const circleId = activeCircle();
    const engine = makeEngine();
    await engine.openNextCycle(circleId);
    await expect(engine.openNextCycle(circleId)).rejects.toThrow(EngineError);
    store.setCircleStatus(circleId, "forming");
    await expect(engine.openNextCycle(circleId)).rejects.toMatchObject({ code: "circle_not_ready" });
  });

  it("payout failure: stays paying_out, retries with backoff, never refunds", async () => {
    const circleId = activeCircle();
    const engine = makeEngine();
    lnd.payResults = ["failed", "succeeded"];
    await engine.openNextCycle(circleId);
    for (const h of hashes(circleId)) lnd.hold(h);
    await flush();

    const stuck = store.latestCycle(circleId);
    expect(stuck).toMatchObject({ state: "paying_out", payoutAttempts: 1, nextRetryMs: now + 5_000 });
    expect(lnd.cancelCalls).toBe(0);

    await engine.tick(); // too early: no retry
    expect(lnd.payCalls).toBe(1);
    now += 5_000;
    await engine.tick();
    expect(store.latestCycle(circleId)?.state).toBe("paid_out");
    expect(lnd.payCalls).toBe(2);
  });

  it("refuses a payout invoice that isn't exactly the pot", async () => {
    const circleId = activeCircle();
    payoutAmount = POT - 1;
    const engine = makeEngine();
    await engine.openNextCycle(circleId);
    for (const h of hashes(circleId)) lnd.hold(h);
    await flush();

    expect(store.latestCycle(circleId)?.state).toBe("paying_out");
    expect(lnd.payCalls).toBe(0);
  });

  it("crash after the first settle: a new engine rolls forward, never cancels", async () => {
    const circleId = activeCircle();
    lnd.notify = false; // the first engine misses everything, as if it crashed
    await makeEngine().openNextCycle(circleId);
    for (const h of hashes(circleId)) lnd.hold(h);
    // It had settled one contribution when it died.
    await lnd.settleHoldInvoice(derivePreimage(secret, { circleId, cycleIndex: 0, attempt: 1, memberPubkey: MEMBERS[0] ?? "" }));
    expect(store.latestCycle(circleId)?.state).toBe("collecting");

    lnd.notify = true;
    await makeEngine().tick();

    expect(store.latestCycle(circleId)?.state).toBe("paid_out");
    expect(lnd.cancelCalls).toBe(0);
    expect([...lnd.invoices.values()].every((i) => i.state === "SETTLED")).toBe(true);
  });

  it("restart mid-collection: the round carries on if nothing is wrong", async () => {
    const circleId = activeCircle();
    await makeEngine().openNextCycle(circleId);
    const [h0, h1, h2] = hashes(circleId);
    lnd.hold(h0 ?? "");

    const restarted = makeEngine();
    await restarted.tick();
    expect(store.latestCycle(circleId)?.state).toBe("collecting");

    lnd.hold(h1 ?? "");
    lnd.hold(h2 ?? "");
    await flush();
    expect(store.latestCycle(circleId)?.state).toBe("paid_out");
  });

  it("an invoice cancelled outside the engine refunds everyone", async () => {
    const circleId = activeCircle();
    const engine = makeEngine();
    await engine.openNextCycle(circleId);
    const [h0, h1] = hashes(circleId);
    lnd.hold(h0 ?? "");
    await lnd.cancelHoldInvoice(h1 ?? ""); // e.g. expired
    await flush();

    expect(store.latestCycle(circleId)?.state).toBe("cancelled");
    expect(lnd.invoices.get(h0 ?? "")?.state).toBe("CANCELED");
  });

  it("marks the circle completed after the last member is paid", async () => {
    const circleId = activeCircle();
    const engine = makeEngine();
    for (let round = 0; round < 3; round++) {
      await engine.openNextCycle(circleId);
      for (const h of hashes(circleId)) lnd.hold(h);
      await flush();
    }
    expect(store.getCircle(circleId)?.status).toBe("completed");
    await expect(engine.openNextCycle(circleId)).rejects.toMatchObject({ code: "circle_complete" });
  });
});
