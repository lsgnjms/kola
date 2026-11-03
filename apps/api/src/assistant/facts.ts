import { potSat, type HoldInvoiceState } from "@kola/shared";
import type { CircleRow, ContributionRow, CycleRow, MemberRow } from "../circles/store.js";

/**
 * The only circle data the AI assistant ever sees: nicknames, amounts, round
 * progress and timing. Built from an allow-list, so pubkeys, payment hashes,
 * invoices, preimages, join codes and wallet details can't leak into a prompt.
 */
export interface AssistantFacts {
  nowUtc: string;
  circle: {
    name: string;
    contributionSat: number;
    memberCount: number;
    membersJoined: number;
    status: "waiting_for_members" | "active" | "complete";
    roundsCompleted: number;
  };
  askedBy: string;
  members: { nickname: string; receivesInRound: number }[];
  currentRound: null | {
    number: number;
    state: "starting" | "collecting" | "everyone_paid_sending_pot" | "pot_sent" | "cancelled_everyone_refunded";
    recipient: string;
    potSat: number;
    deadlineUtc: string;
    minutesLeftToPay: number | null;
    payments: { nickname: string; status: "not_paid" | "paid_set_aside" | "paid_collected" | "refunded" }[];
  };
}

const ROUND_STATE = {
  open: "starting",
  collecting: "collecting",
  settling: "everyone_paid_sending_pot",
  paying_out: "everyone_paid_sending_pot",
  paid_out: "pot_sent",
  cancelled: "cancelled_everyone_refunded",
} as const;

const PAYMENT: Record<HoldInvoiceState, NonNullable<AssistantFacts["currentRound"]>["payments"][number]["status"]> = {
  OPEN: "not_paid",
  ACCEPTED: "paid_set_aside",
  SETTLED: "paid_collected",
  CANCELED: "refunded",
};

export function buildFacts(input: {
  circle: CircleRow;
  members: MemberRow[];
  askedBy: string;
  latest: CycleRow | null;
  contributions: ContributionRow[];
  roundsCompleted: number;
  nowMs: number;
}): AssistantFacts {
  const { circle, members, latest, nowMs } = input;
  const nickname = (pubkey: string) => members.find((m) => m.pubkey === pubkey)?.nickname ?? "a member";
  return {
    nowUtc: new Date(nowMs).toISOString(),
    circle: {
      name: circle.name,
      contributionSat: circle.contributionSat,
      memberCount: circle.memberCount,
      membersJoined: members.length,
      status: circle.status === "forming" ? "waiting_for_members" : circle.status === "completed" ? "complete" : "active",
      roundsCompleted: input.roundsCompleted,
    },
    askedBy: nickname(input.askedBy),
    members: members.map((m) => ({ nickname: m.nickname, receivesInRound: m.position + 1 })),
    currentRound: latest && {
      number: latest.cycleIndex + 1,
      state: ROUND_STATE[latest.state],
      recipient: nickname(latest.recipientPubkey),
      potSat: potSat(circle.contributionSat, circle.memberCount),
      deadlineUtc: new Date(latest.deadlineMs).toISOString(),
      minutesLeftToPay:
        latest.state === "collecting" ? Math.max(0, Math.ceil((latest.deadlineMs - nowMs) / 60_000)) : null,
      payments: input.contributions.map((c) => ({ nickname: nickname(c.memberPubkey), status: PAYMENT[c.state] })),
    },
  };
}
