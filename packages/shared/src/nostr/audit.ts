import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { verifyEvent, type Event } from "nostr-tools/pure";
import { z } from "zod";
import { potSat } from "../money.js";
import { recipientForCycle } from "../rotation.js";
import { PubkeyHex } from "../schemas.js";
import { circleAddress, CircleEvent, KIND_BY_EVENT } from "./events.js";

/**
 * Independent check of a circle's public record, run on the member's own device.
 * Nothing here trusts the server: signatures and hash commitments are recomputed.
 * Pure, and the same on every device, so two members always reach the same verdict.
 */

const Hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`));

const RawEvent = z.object({
  id: Hex(32),
  pubkey: PubkeyHex,
  sig: Hex(64),
  kind: z.number().int(),
  created_at: z.number().int(),
  tags: z.array(z.array(z.string()).max(10)).max(20),
  content: z.string().max(64 * 1024),
});

export type AuditProblemCode =
  | "bad_signature"
  | "wrong_signer"
  | "malformed"
  | "no_definition"
  | "unjoined_member"
  | "hash_mismatch"
  | "preimage_mismatch"
  | "wrong_recipient"
  | "wrong_amount"
  | "payout_before_settled"
  | "settled_after_cancel";

export interface AuditProblem {
  code: AuditProblemCode;
  eventId?: string;
}

export interface AuditEntry {
  id: string;
  createdAtS: number;
  signer: PubkeyHex;
  event: CircleEvent;
}

export interface AuditResult {
  /** Genuine records, oldest fact first. Events failing a signature check are never included. */
  entries: AuditEntry[];
  problems: AuditProblem[];
}

/** Order within a round, so verdicts don't depend on `created_at` ties or relay order. */
const STAGE: Record<CircleEvent["type"], number> = {
  circle_defined: 0,
  circle_joined: 1,
  cycle_opened: 2,
  contribution_held: 3,
  contribution_settled: 4,
  payout_sent: 5,
  cycle_cancelled: 6,
};

export function auditCircle(
  raw: readonly unknown[],
  expected: { circleId: string; coordinatorPubkey: string },
): AuditResult {
  const problems: AuditProblem[] = [];
  const address = circleAddress(expected.coordinatorPubkey, expected.circleId);
  const seen = new Set<string>();
  const entries: AuditEntry[] = [];

  for (const item of raw) {
    const parsed = RawEvent.safeParse(item);
    if (!parsed.success) {
      problems.push({ code: "malformed" });
      continue;
    }
    const nostr: Event = parsed.data;
    if (seen.has(nostr.id)) continue;
    seen.add(nostr.id);
    // Not addressed to this circle: someone else's event on a shared relay, not a problem.
    if (!nostr.tags.some((t) => t[0] === "a" && t[1] === address)) continue;
    if (!verifyEvent(nostr)) {
      problems.push({ code: "bad_signature", eventId: nostr.id });
      continue;
    }
    const event = parseContent(nostr.content);
    if (!event || event.circleId !== expected.circleId || KIND_BY_EVENT[event.type] !== nostr.kind) {
      problems.push({ code: "malformed", eventId: nostr.id });
      continue;
    }
    // Members sign their own joins; everything else is the coordinator's statement.
    const signer = event.type === "circle_joined" ? event.member : expected.coordinatorPubkey;
    if (nostr.pubkey !== signer) {
      problems.push({ code: "wrong_signer", eventId: nostr.id });
      continue;
    }
    entries.push({ id: nostr.id, createdAtS: nostr.created_at, signer: nostr.pubkey, event });
  }

  entries.sort(
    (a, b) =>
      roundOf(a.event) - roundOf(b.event) ||
      attemptOf(a.event) - attemptOf(b.event) ||
      STAGE[a.event.type] - STAGE[b.event.type] ||
      a.createdAtS - b.createdAtS,
  );
  if (entries.length > 0) problems.push(...checkConsistency(entries));
  return { entries, problems };
}

function checkConsistency(entries: readonly AuditEntry[]): AuditProblem[] {
  const problems: AuditProblem[] = [];
  const definition = entries.find(
    (e): e is AuditEntry & { event: Extract<CircleEvent, { type: "circle_defined" }> } =>
      e.event.type === "circle_defined",
  )?.event.definition;
  if (!definition) problems.push({ code: "no_definition" });

  if (definition) {
    const joined = new Set(entries.flatMap((e) => (e.event.type === "circle_joined" ? [e.event.member] : [])));
    for (const member of definition.rotation) {
      if (!joined.has(member)) problems.push({ code: "unjoined_member" });
    }
  }

  const rounds = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    if (!("cycleIndex" in entry.event)) continue;
    const key = `${entry.event.cycleIndex}/${entry.event.attempt}`;
    rounds.set(key, [...(rounds.get(key) ?? []), entry]);
  }

  for (const round of rounds.values()) {
    const committed = new Map<string, string>();
    for (const { event } of round) {
      if (event.type === "cycle_opened") {
        for (const c of event.contributions) committed.set(c.member, c.paymentHash);
        if (definition && event.recipient !== recipientForCycle(definition.rotation, event.cycleIndex)) {
          problems.push({ code: "wrong_recipient" });
        }
      }
    }
    const settled = new Set<string>();
    let cancelled = false;
    for (const { id, event } of round) {
      if (event.type === "cycle_cancelled") cancelled = true;
      if (event.type === "contribution_held" || event.type === "contribution_settled") {
        if (committed.get(event.member) !== event.paymentHash) {
          problems.push({ code: "hash_mismatch", eventId: id });
        }
      }
      if (event.type === "contribution_settled") {
        if (!preimageMatches(event.preimage, event.paymentHash)) {
          problems.push({ code: "preimage_mismatch", eventId: id });
        }
        settled.add(event.member);
      }
      if (event.type === "payout_sent") {
        if (!preimageMatches(event.preimage, event.paymentHash)) {
          problems.push({ code: "preimage_mismatch", eventId: id });
        }
        if (definition) {
          if (event.amountSat !== potSat(definition.contributionSat, definition.memberCount)) {
            problems.push({ code: "wrong_amount", eventId: id });
          }
          if (event.recipient !== recipientForCycle(definition.rotation, event.cycleIndex)) {
            problems.push({ code: "wrong_recipient", eventId: id });
          }
        }
        if (committed.size === 0 || [...committed.keys()].some((m) => !settled.has(m))) {
          problems.push({ code: "payout_before_settled", eventId: id });
        }
      }
    }
    if (cancelled && settled.size > 0) problems.push({ code: "settled_after_cancel" });
  }
  return problems;
}

function preimageMatches(preimage: string, paymentHash: string): boolean {
  return bytesToHex(sha256(hexToBytes(preimage))) === paymentHash;
}

function parseContent(content: string): CircleEvent | null {
  try {
    const parsed = CircleEvent.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Circle-level records sort before every round. */
function roundOf(event: CircleEvent): number {
  return "cycleIndex" in event ? event.cycleIndex : -1;
}

function attemptOf(event: CircleEvent): number {
  return "attempt" in event ? event.attempt : 0;
}
