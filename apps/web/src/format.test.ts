import { describe, expect, it } from "vitest";
import { formatFiat } from "./format.js";

describe("formatFiat", () => {
  const XOF_PER_BTC = 43_000_000;

  it("shows an approximate FCFA value, rounded to whole francs", () => {
    const fcfa = formatFiat("en", 10_000, "XOF", XOF_PER_BTC);
    expect(fcfa).toBe("≈ 4,300 FCFA");
    expect(formatFiat("fr", 10_000, "XOF", XOF_PER_BTC)?.replace(/\s/g, " ")).toBe("≈ 4 300 FCFA");
    expect(formatFiat("en", 30_000, "NGN", 100_000_000)).toBe("≈ ₦30,000");
  });

  it("shows nothing without a usable rate or for tiny amounts", () => {
    expect(formatFiat("en", 10_000, "XOF", undefined)).toBeNull();
    expect(formatFiat("en", 10_000, "XOF", 0)).toBeNull();
    expect(formatFiat("en", 10_000, "XOF", Number.NaN)).toBeNull();
    expect(formatFiat("en", 1, "XOF", XOF_PER_BTC)).toBeNull();
  });
});
