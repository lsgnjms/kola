import type { CircleView, ContributionStatus } from "@kola/shared";

/** "4:05" for minutes:seconds left; "0:00" once past. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function me(view: CircleView) {
  return view.members.find((m) => m.isYou) ?? null;
}

export function memberAt(view: CircleView, position: number) {
  return view.members.find((m) => m.position === position) ?? null;
}

export function myContribution(view: CircleView): ContributionStatus | null {
  const mine = me(view);
  const cycle = view.currentCycle;
  if (!mine || !cycle) return null;
  return cycle.contributions.find((c) => c.position === mine.position)?.status ?? null;
}

/** The member can pay their share right now. */
export function canPay(view: CircleView, nowMs: number): boolean {
  const cycle = view.currentCycle;
  return (
    cycle?.state === "collecting" && cycle.deadlineMs > nowMs && myContribution(view) === "unpaid"
  );
}

/** The organizer can start the next round (none running, circle full, not finished). */
export function canStartRound(view: CircleView): boolean {
  if (!view.isCreator || view.status !== "active") return false;
  const state = view.currentCycle?.state;
  return state === undefined || state === "paid_out" || state === "cancelled";
}

/** 1-based number of the next round to start. */
export function nextRoundNumber(view: CircleView): number {
  return view.completedCycles + 1;
}

/** The round is still moving, so the screen should keep refreshing. */
export function isLive(view: CircleView): boolean {
  const state = view.currentCycle?.state;
  return state === "open" || state === "collecting" || state === "settling" || state === "paying_out";
}
