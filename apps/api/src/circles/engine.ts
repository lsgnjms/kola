import {
  allAccepted,
  isPastDeadline,
  potSat,
  recipientForCycle,
  recoveryAction,
  transition,
  type CircleEvent,
  type CycleEvent,
  type HoldInvoiceState,
} from "@kola/shared";
import type { FastifyBaseLogger } from "fastify";
import { checkInvoiceBeforePay } from "../wallet/invoiceChecks.js";
import { KeyedMutex } from "../wallet/spendCaps.js";
import type { Network, WalletProvider } from "../wallet/WalletProvider.js";
import { derivePreimage, paymentHashOf } from "./preimage.js";
import type { EventPublisher } from "./publisher.js";
import type { CircleStore, CycleKey, CycleRow } from "./store.js";

export interface EngineConfig {
  contributionWindowMs: number;
  cltvExpiryDelta: number;
  maxPayoutFeeSat: number;
  /** First payout retry delay; doubles per attempt up to `payoutRetryMaxMs`. */
  payoutRetryBaseMs: number;
  payoutRetryMaxMs: number;
}

export interface EngineDeps {
  store: CircleStore;
  /** Coordinator node (invoice + payout macaroons). May be unavailable at startup. */
  coordinator: () => Promise<WalletProvider>;
  /** Asks the recipient's wallet for an invoice of exactly `amountSat`. */
  payoutInvoice: (recipientPubkey: string, amountSat: number) => Promise<string>;
  publisher: EventPublisher;
  preimageSecret: Buffer;
  network: Network;
  nowMs: () => number;
  log: FastifyBaseLogger;
  config: EngineConfig;
}

export class EngineError extends Error {
  constructor(
    readonly code: "circle_not_found" | "circle_not_ready" | "cycle_in_progress" | "circle_complete",
  ) {
    super(code);
    this.name = "EngineError";
  }
}

const NON_TERMINAL = ["open", "collecting", "settling", "paying_out"] as const;

/**
 * The cycle engine: the only code that changes cycle state. Every change goes
 * through the shared state machine (`transition`) and is published.
 *
 * Money rule: before the first settle, any problem cancels every hold invoice
 * (everyone refunded). After it, only roll forward: settle the rest, pay out,
 * retry the payout until it succeeds. LND is the source of truth on restart.
 *
 * Work is serialized per circle so subscriptions, the ticker and routes never
 * race on one cycle.
 */
export class CycleEngine {
  private readonly lock = new KeyedMutex();
  private readonly subscriptions = new Map<string, () => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private recovered = false;

  constructor(private readonly deps: EngineDeps) {}

  /** Recovers in-flight cycles, then reconciles every `intervalMs`. */
  start(intervalMs = 2000): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }

  /** Opens the next cycle: one hold invoice per member, recipient from the rotation. */
  async openNextCycle(circleId: string): Promise<CycleRow> {
    return this.lock.run(circleId, async () => {
      const { store, config } = this.deps;
      const circle = store.getCircle(circleId);
      if (!circle) throw new EngineError("circle_not_found");
      if (circle.status === "completed") throw new EngineError("circle_complete");
      if (circle.status !== "active") throw new EngineError("circle_not_ready");
      const latest = store.latestCycle(circleId);
      if (latest && (NON_TERMINAL as readonly string[]).includes(latest.state)) {
        throw new EngineError("cycle_in_progress");
      }

      const members = store.members(circleId);
      const cycleIndex = store.paidOutCount(circleId);
      if (cycleIndex >= circle.memberCount) throw new EngineError("circle_complete");
      const now = this.deps.nowMs();
      const cycle: CycleRow = {
        circleId,
        cycleIndex,
        attempt: store.attemptsFor(circleId, cycleIndex) + 1,
        state: "open",
        recipientPubkey: recipientForCycle(
          members.map((m) => m.pubkey),
          cycleIndex,
        ),
        deadlineMs: now + config.contributionWindowMs,
        openedAtMs: now,
        payoutRequest: null,
        payoutHash: null,
        payoutAttempts: 0,
        nextRetryMs: null,
      };
      store.insertCycle(cycle);

      const coordinator = await this.deps.coordinator();
      try {
        for (const member of members) {
          const paymentHash = paymentHashOf(this.preimage(cycle, member.pubkey));
          const { paymentRequest } = await coordinator.createHoldInvoice({
            paymentHash,
            amountSat: circle.contributionSat,
            // A little longer than the window, so the deadline (not expiry) decides.
            expirySeconds: Math.ceil(config.contributionWindowMs / 1000) + 120,
            cltvExpiryDelta: config.cltvExpiryDelta,
            memo: "Kola",
          });
          store.insertContribution({ ...key(cycle), memberPubkey: member.pubkey, paymentHash, paymentRequest, state: "OPEN" });
        }
      } catch (err) {
        this.deps.log.error({ err, circleId }, "opening cycle failed; cancelling");
        await this.cancelAll(cycle, { type: "ABORT" });
        throw err;
      }

      this.move(cycle, { type: "INVOICES_ISSUED" });
      const contributions = store.contributions(cycle);
      await this.publish({
        type: "cycle_opened",
        circleId,
        cycleIndex,
        attempt: cycle.attempt,
        recipient: cycle.recipientPubkey,
        deadlineMs: cycle.deadlineMs,
        contributions: contributions.map((c) => ({ member: c.memberPubkey, paymentHash: c.paymentHash })),
      });
      for (const c of contributions) this.subscribe(coordinator, c.paymentHash);
      return this.reload(cycle);
    });
  }

  /** Feeds an invoice state from LND (subscription, reconcile, or a contribute call). */
  async onInvoiceState(paymentHash: string, state: HoldInvoiceState): Promise<void> {
    const contribution = this.deps.store.contributionByHash(paymentHash);
    if (!contribution) return;
    await this.lock.run(contribution.circleId, () => this.applyInvoiceState(paymentHash, state));
  }

  /** Deadlines, missed subscription updates, crash recovery and payout retries. */
  async tick(): Promise<void> {
    let coordinator: WalletProvider;
    try {
      coordinator = await this.deps.coordinator();
    } catch {
      return; // Node not up yet; try again next tick.
    }
    try {
      if (!this.recovered) {
        await this.recover(coordinator);
        this.recovered = true;
      }
      for (const cycle of this.deps.store.cyclesInStates(NON_TERMINAL)) {
        await this.lock.run(cycle.circleId, () => this.reconcile(coordinator, cycle));
      }
    } catch (err) {
      this.deps.log.error({ err }, "engine tick failed");
    }
  }

  // --- internals (callers hold the circle lock) ---

  private async recover(coordinator: WalletProvider): Promise<void> {
    for (const cycle of this.deps.store.cyclesInStates(NON_TERMINAL)) {
      await this.lock.run(cycle.circleId, async () => {
        await this.syncFromLnd(coordinator, cycle);
        if (cycle.state === "collecting") {
          for (const c of this.deps.store.contributions(cycle)) this.subscribe(coordinator, c.paymentHash);
        }
      });
    }
  }

  /** Pulls every contribution's state from LND and acts on it. */
  private async reconcile(coordinator: WalletProvider, stale: CycleRow): Promise<void> {
    const cycle = this.reload(stale);
    if (cycle.state === "paying_out") {
      if (cycle.nextRetryMs === null || cycle.nextRetryMs <= this.deps.nowMs()) await this.payout(coordinator, cycle);
      return;
    }
    await this.syncFromLnd(coordinator, cycle);
  }

  private async syncFromLnd(coordinator: WalletProvider, stale: CycleRow): Promise<void> {
    const cycle = this.reload(stale);
    const contributions = this.deps.store.contributions(cycle);
    const states: HoldInvoiceState[] = [];
    for (const c of contributions) {
      const state = await coordinator.lookupInvoiceState(c.paymentHash);
      if (state !== c.state) this.deps.store.setContributionState(c.paymentHash, state);
      states.push(state);
    }
    await this.announceContributions(cycle);

    const action = recoveryAction(cycle.state, states);
    switch (action) {
      case "none":
        return;
      case "manual_review":
        // Some settled, some cancelled: the pot is short. Never guess with money.
        this.deps.log.error({ circleId: cycle.circleId, cycleIndex: cycle.cycleIndex }, "cycle needs manual review");
        return;
      case "pay_out":
        if (cycle.state === "settling") this.move(cycle, { type: "ALL_SETTLED" });
        // A payout already waiting to retry keeps its (persisted) backoff, even across restarts.
        if (cycle.state === "paying_out" && cycle.nextRetryMs !== null && cycle.nextRetryMs > this.deps.nowMs()) return;
        await this.payout(coordinator, this.reload(cycle));
        return;
      case "settle_remaining":
        await this.settleAll(coordinator, cycle);
        return;
      case "cancel_all":
        // A collecting cycle is fine as long as it's before the deadline and nothing was cancelled.
        if (cycle.state === "collecting") {
          if (isPastDeadline(this.deps.nowMs(), cycle.deadlineMs)) {
            await this.cancelAll(cycle, { type: "DEADLINE_MISSED" });
          } else if (states.includes("CANCELED")) {
            await this.cancelAll(cycle, { type: "ABORT" });
          } else if (allAccepted(states)) {
            await this.settleAll(coordinator, cycle);
          }
          return;
        }
        await this.cancelAll(cycle, { type: "ABORT" });
        return;
    }
  }

  private async applyInvoiceState(paymentHash: string, state: HoldInvoiceState): Promise<void> {
    const { store } = this.deps;
    const contribution = store.contributionByHash(paymentHash);
    if (!contribution) return;
    const cycle = store.getCycle(contribution);
    if (!cycle || cycle.state !== "collecting") return;

    if (state !== contribution.state) store.setContributionState(paymentHash, state);
    await this.announceContributions(cycle);

    if (state === "CANCELED") {
      // Expired or cancelled outside the engine: nothing is settled yet, so refund everyone.
      await this.cancelAll(cycle, { type: "ABORT" });
      return;
    }
    const states = store.contributions(cycle).map((c) => c.state);
    if (allAccepted(states) && !isPastDeadline(this.deps.nowMs(), cycle.deadlineMs)) {
      await this.settleAll(await this.deps.coordinator(), cycle);
    }
  }

  /** Point of no return: settle every held contribution, then pay out immediately. */
  private async settleAll(coordinator: WalletProvider, stale: CycleRow): Promise<void> {
    let cycle = this.reload(stale);
    if (cycle.state === "collecting") cycle = this.move(cycle, { type: "ALL_ACCEPTED" });
    if (cycle.state !== "settling") return;

    for (const c of this.deps.store.contributions(cycle)) {
      if (c.state === "SETTLED") continue;
      if (c.state !== "ACCEPTED") {
        // Can't happen via the engine (we only settle when all are held). Stop, don't guess.
        this.deps.log.error({ circleId: cycle.circleId }, "settling with a contribution that is not held");
        return;
      }
      await coordinator.settleHoldInvoice(this.preimage(cycle, c.memberPubkey));
      this.deps.store.setContributionState(c.paymentHash, "SETTLED");
    }
    await this.announceContributions(cycle);
    cycle = this.move(cycle, { type: "ALL_SETTLED" });
    await this.payout(coordinator, cycle);
  }

  /** Pays the pot to the recipient. Safe to call repeatedly; never pays twice. */
  private async payout(coordinator: WalletProvider, stale: CycleRow): Promise<void> {
    const { store, config } = this.deps;
    let cycle = this.reload(stale);
    if (cycle.state !== "paying_out") return;
    const circle = store.getCircle(cycle.circleId);
    if (!circle) return;
    const pot = potSat(circle.contributionSat, circle.memberCount);

    try {
      if (cycle.payoutHash) {
        const previous = await coordinator.lookupPayment(cycle.payoutHash);
        if (previous?.status === "succeeded") return await this.finishPayout(cycle, pot, previous.preimage);
        if (previous?.status === "in_flight") return this.scheduleRetry(cycle);
      }

      // Reuse the stored invoice unless it is about to expire.
      let request = cycle.payoutRequest;
      if (request) {
        const decoded = await coordinator.decodeInvoice(request);
        if (decoded.expiresAtMs - this.deps.nowMs() < 30_000) request = null;
      }
      if (!request) {
        request = await this.deps.payoutInvoice(cycle.recipientPubkey, pot);
        const decoded = await coordinator.decodeInvoice(request);
        const check = checkInvoiceBeforePay(decoded, {
          network: this.deps.network,
          nowMs: this.deps.nowMs(),
          maxAmountSat: pot,
          expectedAmountSat: pot,
          minRemainingMs: 30_000,
        });
        if (!check.ok) throw new Error(`payout invoice rejected: ${check.reason}`);
        store.updateCycle(cycle, { payoutRequest: request, payoutHash: decoded.paymentHash });
        cycle = this.reload(cycle);
      }

      const result = await coordinator.payInvoice({
        paymentRequest: request,
        paymentHash: cycle.payoutHash ?? "",
        maxFeeSat: config.maxPayoutFeeSat,
        timeoutSeconds: 60,
      });
      if (result.status === "succeeded") return await this.finishPayout(cycle, pot, result.preimage);
      this.deps.log.warn({ circleId: cycle.circleId, status: result.status }, "payout not completed; will retry");
    } catch (err) {
      this.deps.log.error({ err, circleId: cycle.circleId }, "payout attempt failed; will retry");
    }
    this.scheduleRetry(cycle);
  }

  private async finishPayout(cycle: CycleRow, pot: number, preimage: string): Promise<void> {
    this.move(cycle, { type: "PAYOUT_SUCCEEDED" });
    const circle = this.deps.store.getCircle(cycle.circleId);
    if (circle && cycle.cycleIndex + 1 >= circle.memberCount) this.deps.store.setCircleStatus(circle.id, "completed");
    await this.publish({
      type: "payout_sent",
      circleId: cycle.circleId,
      cycleIndex: cycle.cycleIndex,
      attempt: cycle.attempt,
      recipient: cycle.recipientPubkey,
      amountSat: pot,
      paymentHash: cycle.payoutHash ?? "",
      preimage,
    });
  }

  private scheduleRetry(cycle: CycleRow): void {
    const { payoutRetryBaseMs, payoutRetryMaxMs } = this.deps.config;
    const attempts = cycle.payoutAttempts + 1;
    const delay = Math.min(payoutRetryMaxMs, payoutRetryBaseMs * 2 ** (attempts - 1));
    this.move(cycle, { type: "PAYOUT_FAILED" });
    this.deps.store.updateCycle(cycle, { payoutAttempts: attempts, nextRetryMs: this.deps.nowMs() + delay });
  }

  /** Cancels every hold invoice (everyone refunded). Only valid before the first settle. */
  private async cancelAll(stale: CycleRow, event: Extract<CycleEvent, { type: "DEADLINE_MISSED" | "ABORT" }>) {
    const cycle = this.reload(stale);
    const contributions = this.deps.store.contributions(cycle);
    if (contributions.some((c) => c.state === "SETTLED")) {
      this.deps.log.error({ circleId: cycle.circleId }, "refusing to cancel: a contribution is already settled");
      return;
    }
    const coordinator = await this.deps.coordinator();
    for (const c of contributions) {
      this.unsubscribe(c.paymentHash);
      if (c.state === "CANCELED") continue;
      await coordinator.cancelHoldInvoice(c.paymentHash);
      this.deps.store.setContributionState(c.paymentHash, "CANCELED");
    }
    this.move(cycle, event);
    await this.publish({
      type: "cycle_cancelled",
      circleId: cycle.circleId,
      cycleIndex: cycle.cycleIndex,
      attempt: cycle.attempt,
      missing: contributions.filter((c) => c.state !== "ACCEPTED").map((c) => c.memberPubkey),
    });
  }

  /**
   * Records what LND says about each contribution. Safe to repeat (the publisher
   * ignores facts it already has), so however a state was learned (subscription,
   * ticker, or recovery after a crash) the public record ends up complete.
   */
  private async announceContributions(cycle: CycleKey): Promise<void> {
    for (const c of this.deps.store.contributions(cycle)) {
      const fact = {
        circleId: c.circleId,
        cycleIndex: c.cycleIndex,
        attempt: c.attempt,
        member: c.memberPubkey,
        paymentHash: c.paymentHash,
      };
      if (c.state === "ACCEPTED" || c.state === "SETTLED") await this.publish({ type: "contribution_held", ...fact });
      if (c.state === "SETTLED") {
        await this.publish({ type: "contribution_settled", ...fact, preimage: this.preimage(cycle, c.memberPubkey) });
      }
    }
  }

  private subscribe(coordinator: WalletProvider, paymentHash: string): void {
    if (this.subscriptions.has(paymentHash)) return;
    const unsubscribe = coordinator.subscribeInvoice(paymentHash, {
      onState: (state) => void this.onInvoiceState(paymentHash, state).catch((err: unknown) => {
        this.deps.log.error({ err }, "handling invoice update failed");
      }),
      // The ticker reconciles from LND anyway; resubscribe on the next recover/open.
      onError: () => this.subscriptions.delete(paymentHash),
    });
    this.subscriptions.set(paymentHash, unsubscribe);
  }

  private unsubscribe(paymentHash: string): void {
    this.subscriptions.get(paymentHash)?.();
    this.subscriptions.delete(paymentHash);
  }

  /** Applies a state-machine event, persists it and returns the updated row. */
  private move(cycle: CycleRow, event: CycleEvent): CycleRow {
    const next = transition(cycle.state, event);
    this.deps.store.updateCycle(cycle, { state: next });
    return { ...cycle, state: next };
  }

  private reload(cycle: CycleKey): CycleRow {
    const row = this.deps.store.getCycle(cycle);
    if (!row) throw new Error("cycle disappeared");
    return row;
  }

  private preimage(cycle: CycleKey, memberPubkey: string): string {
    return derivePreimage(this.deps.preimageSecret, { ...key(cycle), memberPubkey });
  }

  private async publish(event: CircleEvent): Promise<void> {
    try {
      await this.deps.publisher.publish(event);
    } catch (err) {
      this.deps.log.error({ err, type: event.type }, "publishing circle event failed");
    }
  }
}

function key(c: CycleKey): CycleKey {
  return { circleId: c.circleId, cycleIndex: c.cycleIndex, attempt: c.attempt };
}
