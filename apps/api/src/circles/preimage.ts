import { createHash, createHmac } from "node:crypto";
import type { PaymentHashHex } from "@kola/shared";

export interface ContributionRef {
  circleId: string;
  cycleIndex: number;
  attempt: number;
  memberPubkey: string;
}

/**
 * Hold-invoice preimages are derived, never stored: HMAC-SHA256(secret, ref).
 * After a crash the engine can recompute any preimage it needs to settle, and a
 * stolen database reveals none of them. `attempt` changes when a cancelled cycle
 * is reopened, so hashes never repeat (LND refuses reused hashes).
 */
export function derivePreimage(secret: Buffer, ref: ContributionRef): string {
  return createHmac("sha256", secret)
    .update(`kola/preimage/v1/${ref.circleId}/${ref.cycleIndex}/${ref.attempt}/${ref.memberPubkey}`)
    .digest("hex");
}

export function paymentHashOf(preimageHex: string): PaymentHashHex {
  return createHash("sha256").update(Buffer.from(preimageHex, "hex")).digest("hex");
}
