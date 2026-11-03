import type { CircleView } from "@kola/shared";
import { describe, expect, it } from "vitest";
import { t as translate } from "../../i18n/index.js";
import { quickAnswer, type QuickQuestion } from "./quickAnswers.js";

const NOW = 1_700_000_000_000;
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars);
const sats = (n: number) => String(n);

const base: CircleView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Marché HLM tontine",
  contributionSat: 10_000,
  memberCount: 3,
  status: "active",
  joinCode: "DAKAR2",
  isCreator: false,
  coordinatorPubkey: "f".repeat(64),
  joinRecorded: true,
  members: [
    { position: 0, pubkey: "a".repeat(64), nickname: "Aminata", isYou: false, isCreator: true },
    { position: 1, pubkey: "b".repeat(64), nickname: "Fatou", isYou: true, isCreator: false },
    { position: 2, pubkey: "c".repeat(64), nickname: "Moussa", isYou: false, isCreator: false },
  ],
  completedCycles: 0,
  currentCycle: null,
};

const collecting: CircleView = {
  ...base,
  currentCycle: {
    cycleIndex: 0,
    attempt: 1,
    state: "collecting",
    recipientPosition: 0,
    deadlineMs: NOW + 125_000,
    potSat: 30_000,
    contributions: [
      { position: 0, status: "held" },
      { position: 1, status: "unpaid" },
      { position: 2, status: "unpaid" },
    ],
  },
};

const ask = (view: CircleView, q: QuickQuestion) => quickAnswer(t, view, q, NOW, sats);
const round = () => {
  if (!collecting.currentCycle) throw new Error("fixture has no round");
  return collecting.currentCycle;
};

describe("quickAnswer", () => {
  it("says whose turn it is, during and between rounds", () => {
    expect(ask(collecting, "whose_turn")).toBe("Aminata receives the pot this round (30000 sats).");
    const after = { ...base, completedCycles: 1, currentCycle: { ...round(), state: "paid_out" as const } };
    expect(ask(after, "whose_turn")).toContain("Fatou");
    expect(ask({ ...base, status: "completed" }, "whose_turn")).toBe(t("answer.turnDone"));
    expect(ask({ ...base, status: "forming" }, "whose_turn")).toBe(t("circle.notReady"));
  });

  it("lists who still owes and the time left", () => {
    expect(ask(collecting, "who_owes")).toBe("Still to pay: Fatou, Moussa. Time left: 2:05.");
    expect(ask(base, "who_owes")).toBe(t("answer.owesNoRound"));
    const allPaid = {
      ...collecting,
      currentCycle: { ...round(), contributions: round().contributions.map((c) => ({ ...c, status: "held" as const })) },
    };
    expect(ask(allPaid, "who_owes")).toBe(t("answer.owesNone"));
  });

  it("drafts a reminder naming only those who haven't paid", () => {
    const reminder = ask(collecting, "reminder");
    expect(reminder).toContain("Fatou, Moussa");
    expect(reminder).toContain("10000 sats");
    expect(reminder).not.toContain("Aminata,");
    expect(ask(base, "reminder")).toBe(t("answer.reminderNone"));
  });
});
