import { z } from "zod";

/** Hex-encoded 32-byte Nostr public key. */
export const PubkeyHex = z.string().regex(/^[0-9a-f]{64}$/);
export type PubkeyHex = z.infer<typeof PubkeyHex>;

/** Hex-encoded 32-byte Lightning payment hash. */
export const PaymentHashHex = z.string().regex(/^[0-9a-f]{64}$/);
export type PaymentHashHex = z.infer<typeof PaymentHashHex>;

export const AmountSat = z.number().int().positive().max(21_000_000 * 100_000_000);

/** Unix time in milliseconds, UTC. */
export const TimestampMs = z.number().int().nonnegative();

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 50;

export const CircleDefinition = z
  .object({
    id: z.string().uuid(),
    /** Pseudonymous; never a real name or phone number (published on Nostr). */
    name: z.string().trim().min(1).max(60),
    contributionSat: AmountSat,
    periodSeconds: z.number().int().positive(),
    memberCount: z.number().int().min(MIN_MEMBERS).max(MAX_MEMBERS),
    coordinatorPubkey: PubkeyHex,
    /** Recipient order: rotation[k % memberCount] receives the pot in cycle k. */
    rotation: z.array(PubkeyHex),
  })
  .refine((c) => c.rotation.length === c.memberCount, {
    message: "rotation must list every member exactly once",
    path: ["rotation"],
  })
  .refine((c) => new Set(c.rotation).size === c.rotation.length, {
    message: "rotation must not repeat a member",
    path: ["rotation"],
  });
export type CircleDefinition = z.infer<typeof CircleDefinition>;

export const CycleState = z.enum([
  "open",
  "collecting",
  "settling",
  "paying_out",
  "paid_out",
  "cancelled",
]);
export type CycleState = z.infer<typeof CycleState>;

/** Mirrors LND's invoice states for a member's hold invoice. */
export const HoldInvoiceState = z.enum(["OPEN", "ACCEPTED", "SETTLED", "CANCELED"]);
export type HoldInvoiceState = z.infer<typeof HoldInvoiceState>;
