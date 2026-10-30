import type { EventTemplate } from "nostr-tools/pure";
import { z } from "zod";
import { AmountSat, CircleDefinition, PaymentHashHex, PubkeyHex } from "../schemas.js";
import { KIND, type KolaKind } from "./kinds.js";

/**
 * The public record of a circle. Only pubkeys, amounts in sats and payment
 * data: never names, nicknames or phone numbers, and a preimage only once its
 * contribution is settled (each member's preimage is independent, so it reveals
 * nothing about the others).
 */

const Hex32 = PaymentHashHex;
const Base = { circleId: z.string().uuid() };
const Round = { ...Base, cycleIndex: z.number().int().nonnegative(), attempt: z.number().int().positive() };

export const CircleEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("circle_defined"), ...Base, definition: CircleDefinition }),
  /** Signed by the member, on their own device: the coordinator can't invent members. */
  z.object({
    type: z.literal("circle_joined"),
    ...Base,
    member: PubkeyHex,
    contributionSat: AmountSat,
    memberCount: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("cycle_opened"),
    ...Round,
    recipient: PubkeyHex,
    deadlineMs: z.number().int().nonnegative(),
    contributions: z.array(z.object({ member: PubkeyHex, paymentHash: PaymentHashHex })),
  }),
  z.object({ type: z.literal("contribution_held"), ...Round, member: PubkeyHex, paymentHash: PaymentHashHex }),
  z.object({
    type: z.literal("contribution_settled"),
    ...Round,
    member: PubkeyHex,
    paymentHash: PaymentHashHex,
    preimage: Hex32,
  }),
  z.object({
    type: z.literal("payout_sent"),
    ...Round,
    recipient: PubkeyHex,
    amountSat: AmountSat,
    paymentHash: PaymentHashHex,
    preimage: Hex32,
  }),
  z.object({ type: z.literal("cycle_cancelled"), ...Round, missing: z.array(PubkeyHex) }),
]);
export type CircleEvent = z.infer<typeof CircleEvent>;

export const KIND_BY_EVENT: Record<CircleEvent["type"], KolaKind> = {
  circle_defined: KIND.CIRCLE_DEFINITION,
  circle_joined: KIND.CIRCLE_JOIN,
  cycle_opened: KIND.CYCLE_OPENED,
  contribution_held: KIND.CONTRIBUTION_HELD,
  contribution_settled: KIND.CONTRIBUTION_SETTLED,
  payout_sent: KIND.PAYOUT_SENT,
  cycle_cancelled: KIND.CYCLE_CANCELLED,
};

export const CIRCLE_KINDS: readonly KolaKind[] = Object.values(KIND_BY_EVENT);

/** NIP-33 style address of a circle; every event of the circle carries it as an `a` tag. */
export function circleAddress(coordinatorPubkey: string, circleId: string): string {
  return `${KIND.CIRCLE_DEFINITION}:${coordinatorPubkey}:${circleId}`;
}

export function buildCircleEvent(
  event: CircleEvent,
  ctx: { coordinatorPubkey: string; nowS: number },
): EventTemplate {
  const tags = [["a", circleAddress(ctx.coordinatorPubkey, event.circleId)]];
  if (event.type === "circle_defined") tags.push(["d", event.circleId]);
  return { kind: KIND_BY_EVENT[event.type], created_at: ctx.nowS, tags, content: JSON.stringify(event) };
}

/** Identity of a fact: announcing the same fact again must not create a second record. */
export function eventKey(event: CircleEvent): string {
  const round = "cycleIndex" in event ? `${event.cycleIndex}/${event.attempt}` : "";
  const subject = "member" in event ? event.member : "";
  return `${event.type}:${event.circleId}:${round}:${subject}`;
}
