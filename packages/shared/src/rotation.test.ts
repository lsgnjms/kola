import { describe, expect, it } from "vitest";
import { cyclesUntilTurn, recipientForCycle } from "./rotation.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const rotation = [A, B, C];

describe("recipientForCycle", () => {
  it("walks the rotation and wraps", () => {
    expect([0, 1, 2, 3].map((k) => recipientForCycle(rotation, k))).toEqual([A, B, C, A]);
  });

  it("rejects empty rotations and bad indexes", () => {
    expect(() => recipientForCycle([], 0)).toThrow(RangeError);
    expect(() => recipientForCycle(rotation, -1)).toThrow(RangeError);
  });
});

describe("cyclesUntilTurn", () => {
  it("counts forward with wrap-around", () => {
    expect(cyclesUntilTurn(rotation, A, 0)).toBe(0);
    expect(cyclesUntilTurn(rotation, C, 0)).toBe(2);
    expect(cyclesUntilTurn(rotation, A, 1)).toBe(2);
  });

  it("rejects non-members", () => {
    expect(() => cyclesUntilTurn(rotation, "d".repeat(64), 0)).toThrow(RangeError);
  });
});
