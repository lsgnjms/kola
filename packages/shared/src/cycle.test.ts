import { describe, expect, it } from "vitest";
import {
  allAccepted,
  InvalidTransitionError,
  isPastDeadline,
  recoveryAction,
  transition,
} from "./cycle.js";

describe("transition", () => {
  it("follows the happy path", () => {
    let s = transition("open", { type: "INVOICES_ISSUED" });
    expect(s).toBe("collecting");
    s = transition(s, { type: "ALL_ACCEPTED" });
    expect(s).toBe("settling");
    s = transition(s, { type: "ALL_SETTLED" });
    expect(s).toBe("paying_out");
    s = transition(s, { type: "PAYOUT_FAILED" });
    expect(s).toBe("paying_out");
    s = transition(s, { type: "PAYOUT_SUCCEEDED" });
    expect(s).toBe("paid_out");
  });

  it("cancels on missed deadline while collecting", () => {
    expect(transition("collecting", { type: "DEADLINE_MISSED" })).toBe("cancelled");
  });

  it("never cancels once settling has started", () => {
    expect(() => transition("settling", { type: "DEADLINE_MISSED" })).toThrow(InvalidTransitionError);
    expect(() => transition("settling", { type: "ABORT" })).toThrow(InvalidTransitionError);
    expect(() => transition("paying_out", { type: "ABORT" })).toThrow(InvalidTransitionError);
  });

  it("rejects transitions out of terminal states", () => {
    expect(() => transition("paid_out", { type: "INVOICES_ISSUED" })).toThrow(InvalidTransitionError);
    expect(() => transition("cancelled", { type: "ALL_ACCEPTED" })).toThrow(InvalidTransitionError);
  });
});

describe("recoveryAction", () => {
  it("cancels everything when nothing has settled", () => {
    expect(recoveryAction("collecting", ["ACCEPTED", "OPEN", "ACCEPTED"])).toBe("cancel_all");
    expect(recoveryAction("open", [])).toBe("cancel_all");
  });

  it("rolls forward once any invoice has settled, even if the cache says collecting", () => {
    expect(recoveryAction("collecting", ["SETTLED", "ACCEPTED", "ACCEPTED"])).toBe("settle_remaining");
    expect(recoveryAction("settling", ["SETTLED", "ACCEPTED"])).toBe("settle_remaining");
  });

  it("settles remaining when crash happened in settling before any settle", () => {
    expect(recoveryAction("settling", ["ACCEPTED", "ACCEPTED"])).toBe("settle_remaining");
  });

  it("pays out when every invoice is settled", () => {
    expect(recoveryAction("settling", ["SETTLED", "SETTLED"])).toBe("pay_out");
    expect(recoveryAction("paying_out", ["SETTLED", "SETTLED"])).toBe("pay_out");
  });

  it("flags a short pot for manual review", () => {
    expect(recoveryAction("settling", ["SETTLED", "CANCELED"])).toBe("manual_review");
  });

  it("does nothing for terminal states", () => {
    expect(recoveryAction("paid_out", ["SETTLED"])).toBe("none");
    expect(recoveryAction("cancelled", ["CANCELED"])).toBe("none");
  });
});

describe("helpers", () => {
  it("allAccepted requires at least one invoice and all ACCEPTED", () => {
    expect(allAccepted([])).toBe(false);
    expect(allAccepted(["ACCEPTED", "OPEN"])).toBe(false);
    expect(allAccepted(["ACCEPTED", "ACCEPTED"])).toBe(true);
  });

  it("isPastDeadline is inclusive of the deadline instant", () => {
    expect(isPastDeadline(999, 1000)).toBe(false);
    expect(isPastDeadline(1000, 1000)).toBe(true);
  });
});
