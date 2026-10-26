import { describe, expect, it } from "vitest";
import { potSat, satToMsat } from "./money.js";

describe("potSat", () => {
  it("multiplies contribution by member count", () => {
    expect(potSat(10_000, 3)).toBe(30_000);
  });

  it("rejects fractional or negative amounts", () => {
    expect(() => potSat(10.5, 3)).toThrow(RangeError);
    expect(() => potSat(-1, 3)).toThrow(RangeError);
  });

  it("rejects overflow past safe integers", () => {
    expect(() => potSat(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});

describe("satToMsat", () => {
  it("converts exactly", () => {
    expect(satToMsat(21)).toBe(21_000);
  });
});
