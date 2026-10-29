import type { FastifyBaseLogger } from "fastify";

/** Cycle transitions the engine announces (published as signed Nostr events in the Nostr milestone). */
export type CircleEvent =
  | { type: "cycle_opened"; circleId: string; cycleIndex: number; attempt: number; recipient: string; deadlineMs: number }
  | { type: "contribution_held"; circleId: string; cycleIndex: number; member: string }
  | { type: "contribution_settled"; circleId: string; cycleIndex: number; member: string }
  | { type: "payout_sent"; circleId: string; cycleIndex: number; recipient: string; amountSat: number }
  | { type: "cycle_cancelled"; circleId: string; cycleIndex: number; attempt: number; missing: string[] };

export interface EventPublisher {
  /** Must not throw: a relay outage never blocks moving money. */
  publish(event: CircleEvent): Promise<void>;
}

/**
 * Placeholder until the Nostr publisher lands: records each event in the log.
 * Contains only ids, pubkeys and amounts (no invoices or preimages).
 */
export class LogPublisher implements EventPublisher {
  constructor(private readonly log: FastifyBaseLogger) {}

  async publish(event: CircleEvent): Promise<void> {
    this.log.info({ circleEvent: event }, `circle event: ${event.type}`);
  }
}
