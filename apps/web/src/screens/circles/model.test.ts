import type { CircleView } from "@kola/shared";
import { describe, expect, it } from "vitest";
import { canPay, canStartRound, formatCountdown, isLive, myContribution, nextRoundNumber } from "./model.js";

const NOW = 1_700_000_000_000;

function circle(overrides: Partial<CircleView> = {}): CircleView {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Market tontine",
    contributionSat: 1000,
    memberCount: 3,
    status: "active",
    joinCode: "ABCDEF",
    isCreator: true,
    coordinatorPubkey: "f".repeat(64),
    joinRecorded: true,
    members: [
      { position: 0, pubkey: "a".repeat(64), nickname: "Awa", isYou: true, isCreator: true },
      { position: 1, pubkey: "b".repeat(64), nickname: "Bola", isYou: false, isCreator: false },
      { position: 2, pubkey: "c".repeat(64), nickname: "Chidi", isYou: false, isCreator: false },
    ],
    completedCycles: 0,
    currentCycle: null,
    ...overrides,
  };
}

const collecting = (mine: "unpaid" | "held", deadlineMs = NOW + 60_000): NonNullable<CircleView["currentCycle"]> => ({
  cycleIndex: 0,
  attempt: 1,
  state: "collecting",
  recipientPosition: 0,
  deadlineMs,
  potSat: 3000,
  contributions: [
    { position: 0, status: mine },
    { position: 1, status: "held" },
    { position: 2, status: "unpaid" },
  ],
});

describe("circle model", () => {
  it("formats the countdown", () => {
    expect(formatCountdown(245_000)).toBe("4:05");
    expect(formatCountdown(500)).toBe("0:01");
    expect(formatCountdown(-1)).toBe("0:00");
  });

  it("lets a member pay only their own unpaid share, before the deadline", () => {
    expect(canPay(circle({ currentCycle: collecting("unpaid") }), NOW)).toBe(true);
    expect(myContribution(circle({ currentCycle: collecting("held") }))).toBe("held");
    expect(canPay(circle({ currentCycle: collecting("held") }), NOW)).toBe(false);
    expect(canPay(circle({ currentCycle: collecting("unpaid", NOW - 1) }), NOW)).toBe(false);
    expect(canPay(circle(), NOW)).toBe(false);
  });

  it("lets only the organizer start a round, one at a time", () => {
    expect(canStartRound(circle())).toBe(true);
    expect(canStartRound(circle({ isCreator: false }))).toBe(false);
    expect(canStartRound(circle({ status: "forming" }))).toBe(false);
    expect(canStartRound(circle({ currentCycle: collecting("unpaid") }))).toBe(false);
    const done = circle({ completedCycles: 1, currentCycle: { ...collecting("held"), state: "paid_out" } });
    expect(canStartRound(done)).toBe(true);
    expect(nextRoundNumber(done)).toBe(2);
    expect(canStartRound(circle({ status: "completed" }))).toBe(false);
  });

  it("keeps refreshing only while a round is moving", () => {
    expect(isLive(circle({ currentCycle: collecting("unpaid") }))).toBe(true);
    expect(isLive(circle({ currentCycle: { ...collecting("held"), state: "cancelled" } }))).toBe(false);
  });
});
