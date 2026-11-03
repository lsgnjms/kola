import { describe, expect, it } from "vitest";
import type { CircleRow, ContributionRow, CycleRow, MemberRow } from "../circles/store.js";
import { buildFacts } from "./facts.js";

const NOW = 1_700_000_000_000;
const [A, B, C] = ["a".repeat(64), "b".repeat(64), "c".repeat(64)] as const;
const circle: CircleRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Marché HLM tontine",
  contributionSat: 10_000,
  memberCount: 3,
  periodSeconds: 604800,
  creatorPubkey: A,
  joinCode: "DAKAR2",
  status: "active",
  createdAtMs: NOW,
};
const members: MemberRow[] = [
  { pubkey: A, position: 0, nickname: "Aminata" },
  { pubkey: B, position: 1, nickname: "Fatou" },
  { pubkey: C, position: 2, nickname: "Moussa" },
];
const key = { circleId: circle.id, cycleIndex: 0, attempt: 1 };
const latest: CycleRow = {
  ...key,
  state: "collecting",
  recipientPubkey: A,
  deadlineMs: NOW + 4.5 * 60_000,
  openedAtMs: NOW,
  payoutRequest: "lnbcrt-secret-invoice",
  payoutHash: "d".repeat(64),
  payoutAttempts: 0,
  nextRetryMs: null,
};
const contributions: ContributionRow[] = [
  { ...key, memberPubkey: A, paymentHash: "e".repeat(64), paymentRequest: "lnbcrt-hold-a", state: "ACCEPTED" },
  { ...key, memberPubkey: B, paymentHash: "f".repeat(64), paymentRequest: "lnbcrt-hold-b", state: "OPEN" },
  { ...key, memberPubkey: C, paymentHash: "9".repeat(64), paymentRequest: "lnbcrt-hold-c", state: "OPEN" },
];

describe("buildFacts", () => {
  const facts = buildFacts({ circle, members, askedBy: B, latest, contributions, roundsCompleted: 0, nowMs: NOW });

  it("describes the round in plain terms", () => {
    expect(facts.askedBy).toBe("Fatou");
    expect(facts.currentRound).toMatchObject({
      number: 1,
      state: "collecting",
      recipient: "Aminata",
      potSat: 30_000,
      minutesLeftToPay: 5,
    });
    expect(facts.currentRound?.payments).toEqual([
      { nickname: "Aminata", status: "paid_set_aside" },
      { nickname: "Fatou", status: "not_paid" },
      { nickname: "Moussa", status: "not_paid" },
    ]);
  });

  it("never carries keys, payment data or the join code", () => {
    const sent = JSON.stringify(facts);
    for (const secret of [A, B, C, "lnbcrt", "d".repeat(64), "e".repeat(64), "DAKAR2"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("handles a circle with no round yet", () => {
    const none = buildFacts({ circle, members, askedBy: A, latest: null, contributions: [], roundsCompleted: 0, nowMs: NOW });
    expect(none.currentRound).toBeNull();
    expect(none.members.map((m) => m.receivesInRound)).toEqual([1, 2, 3]);
  });
});
