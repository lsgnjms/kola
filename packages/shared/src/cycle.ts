import type { CycleState, HoldInvoiceState } from "./schemas.js";

/**
 * Cycle state machine. The only place cycle transitions are defined; the API's
 * cycle engine applies these and publishes a Nostr event for each.
 *
 *   open → collecting → settling → paying_out → paid_out
 *              └──────→ cancelled
 *
 * The first settle is the point of no return: before it, any problem cancels
 * every hold invoice; after it, the engine only rolls forward.
 */
export type CycleEvent =
  | { type: "INVOICES_ISSUED" }
  | { type: "ALL_ACCEPTED" }
  | { type: "DEADLINE_MISSED" }
  | { type: "ABORT" }
  | { type: "ALL_SETTLED" }
  | { type: "PAYOUT_SUCCEEDED" }
  | { type: "PAYOUT_FAILED" };

const TRANSITIONS: Record<CycleState, Partial<Record<CycleEvent["type"], CycleState>>> = {
  open: { INVOICES_ISSUED: "collecting", ABORT: "cancelled" },
  collecting: { ALL_ACCEPTED: "settling", DEADLINE_MISSED: "cancelled", ABORT: "cancelled" },
  // No cancel edges from here on: preimages may already be revealed.
  settling: { ALL_SETTLED: "paying_out" },
  paying_out: { PAYOUT_SUCCEEDED: "paid_out", PAYOUT_FAILED: "paying_out" },
  paid_out: {},
  cancelled: {},
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: CycleState,
    readonly event: CycleEvent["type"],
  ) {
    super(`invalid cycle transition: ${from} --${event}-->`);
    this.name = "InvalidTransitionError";
  }
}

export function transition(from: CycleState, event: CycleEvent): CycleState {
  const to = TRANSITIONS[from][event.type];
  if (to === undefined) throw new InvalidTransitionError(from, event.type);
  return to;
}

export function isTerminal(state: CycleState): boolean {
  return state === "paid_out" || state === "cancelled";
}

export type RecoveryAction =
  | "none"
  | "cancel_all"
  | "settle_remaining"
  | "pay_out"
  /** Some contributions settled and others cancelled: the pot is short. Needs a human. */
  | "manual_review";

/**
 * What to do with a cycle after a crash, restart or detected inconsistency,
 * given the stored state and the live invoice states read back from LND.
 * LND is the source of truth: if any invoice is SETTLED we are past the point
 * of no return regardless of what the cache says.
 *
 * `pay_out` must itself be idempotent: look up the payout by payment hash
 * before sending, since it may have succeeded just before the crash.
 */
export function recoveryAction(
  state: CycleState,
  invoices: readonly HoldInvoiceState[],
): RecoveryAction {
  if (isTerminal(state)) return "none";

  const anySettled = invoices.includes("SETTLED");
  if (anySettled && invoices.includes("CANCELED")) return "manual_review";
  if (state === "paying_out") return "pay_out";
  if (anySettled || state === "settling") {
    return invoices.every((s) => s === "SETTLED") ? "pay_out" : "settle_remaining";
  }
  return "cancel_all";
}

/** True when every member's hold invoice is held and the cycle can move to settling. */
export function allAccepted(invoices: readonly HoldInvoiceState[]): boolean {
  return invoices.length > 0 && invoices.every((s) => s === "ACCEPTED");
}

export function isPastDeadline(nowMs: number, deadlineMs: number): boolean {
  return nowMs >= deadlineMs;
}
