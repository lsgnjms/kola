import type { FastifyBaseLogger } from "fastify";
import { preparePayment, type PayContext, type PayError } from "../wallet/pay.js";
import type { WalletProvider } from "../wallet/WalletProvider.js";
import type { CycleEngine } from "./engine.js";
import type { CircleStore } from "./store.js";

export type ContributeOutcome =
  | { ok: true; status: "held" | "pending" | "already_paid" }
  /** Every error here means no money left the wallet. */
  | { ok: false; error: PayError | "no_open_cycle" | "not_a_member" };

export interface ContributeDeps {
  store: CircleStore;
  engine: CycleEngine;
  coordinator: () => Promise<WalletProvider>;
  log: FastifyBaseLogger;
  /** How long to wait for the coordinator to see the payment held. */
  waitMs?: number;
}

/**
 * Pays the member's share of the open cycle from their wallet. A hold-invoice
 * payment stays in flight until the whole cycle settles or is cancelled, so we
 * don't wait for it to complete: we return as soon as the coordinator sees it
 * held. Same checks as any payment (exact amount, caps, network, expiry).
 * Callers must hold the member's payment lock.
 */
export async function contribute(
  deps: ContributeDeps,
  wallet: WalletProvider,
  circleId: string,
  memberPubkey: string,
  ctx: Omit<PayContext, "expectedAmountSat">,
): Promise<ContributeOutcome> {
  const circle = deps.store.getCircle(circleId);
  const cycle = deps.store.latestCycle(circleId);
  if (!circle || !cycle || cycle.state !== "collecting") return { ok: false, error: "no_open_cycle" };
  const mine = deps.store.contributions(cycle).find((c) => c.memberPubkey === memberPubkey);
  if (!mine) return { ok: false, error: "not_a_member" };

  const coordinator = await deps.coordinator();
  const current = await coordinator.lookupInvoiceState(mine.paymentHash);
  if (current === "ACCEPTED" || current === "SETTLED") {
    await deps.engine.onInvoiceState(mine.paymentHash, current);
    return { ok: true, status: "already_paid" };
  }
  if (current === "CANCELED") return { ok: false, error: "no_open_cycle" };

  const prepared = await preparePayment(wallet, mine.paymentRequest, { ...ctx, expectedAmountSat: circle.contributionSat });
  if (!prepared.ok) return prepared;
  if (prepared.paymentHash !== mine.paymentHash) return { ok: false, error: "invalid_invoice" };

  let failed = false;
  void wallet
    .payInvoice({
      paymentRequest: mine.paymentRequest,
      paymentHash: mine.paymentHash,
      maxFeeSat: prepared.maxFeeSat,
      timeoutSeconds: 60,
    })
    .then((result) => {
      // "failed" here before the hold means no route: nothing left the wallet.
      if (result.status === "failed") failed = true;
    })
    .catch((err: unknown) => deps.log.warn({ err }, "contribution payment stream ended with an error"));

  const until = Date.now() + (deps.waitMs ?? 20_000);
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 300));
    const state = await coordinator.lookupInvoiceState(mine.paymentHash);
    if (state === "ACCEPTED" || state === "SETTLED") {
      await deps.engine.onInvoiceState(mine.paymentHash, state);
      return { ok: true, status: "held" };
    }
    if (failed) return { ok: false, error: "payment_failed" };
  }
  return { ok: true, status: "pending" };
}
