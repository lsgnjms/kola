import type { CircleView } from "@kola/shared";
import type { Translate } from "../../i18n/index.js";
import { formatCountdown, isLive, memberAt, nextRoundNumber } from "./model.js";

export type QuickQuestion = "whose_turn" | "who_owes" | "reminder";

/**
 * Answers to the quick questions, computed on the phone from what the circle
 * screen already shows. No network, no AI key, same in every language.
 */
export function quickAnswer(
  t: Translate,
  view: CircleView,
  question: QuickQuestion,
  nowMs: number,
  sats: (amountSat: number) => string,
): string {
  const cycle = view.currentCycle;
  const nameAt = (position: number) => memberAt(view, position)?.nickname ?? "?";
  const unpaid =
    cycle?.state === "collecting"
      ? cycle.contributions.filter((c) => c.status === "unpaid").map((c) => nameAt(c.position))
      : [];
  const timeLeft = cycle ? formatCountdown(cycle.deadlineMs - nowMs) : "";

  switch (question) {
    case "whose_turn": {
      if (view.status === "completed") return t("answer.turnDone");
      if (view.status === "forming") return t("circle.notReady");
      if (cycle && isLive(view)) {
        return t("answer.turnCurrent", { name: nameAt(cycle.recipientPosition), amount: sats(cycle.potSat) });
      }
      const n = nextRoundNumber(view);
      return t("answer.turnNext", { name: nameAt((n - 1) % view.memberCount), n });
    }
    case "who_owes":
      if (cycle?.state !== "collecting") return t("answer.owesNoRound");
      if (unpaid.length === 0) return t("answer.owesNone");
      return t("answer.owesSome", { names: unpaid.join(", "), time: timeLeft });
    case "reminder":
      if (!cycle || unpaid.length === 0) return t("answer.reminderNone");
      return t("answer.reminder", {
        names: unpaid.join(", "),
        circle: view.name,
        n: cycle.cycleIndex + 1,
        amount: sats(view.contributionSat),
        time: timeLeft,
      });
  }
}
