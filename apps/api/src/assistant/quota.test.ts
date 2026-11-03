import { describe, expect, it } from "vitest";
import { DailyQuota } from "./quota.js";

const DAY = 24 * 3600 * 1000;
const NOON = Date.UTC(2026, 10, 3, 12);

describe("DailyQuota", () => {
  it("allows the limit per key per day, then refuses", () => {
    const quota = new DailyQuota(3);
    expect([1, 2, 3, 4].map(() => quota.take("aminata", NOON))).toEqual([true, true, true, false]);
    expect(quota.take("fatou", NOON)).toBe(true);
  });

  it("starts fresh the next UTC day", () => {
    const quota = new DailyQuota(1);
    expect(quota.take("aminata", NOON)).toBe(true);
    expect(quota.take("aminata", NOON + 11 * 3600 * 1000)).toBe(false); // 23:00, same day
    expect(quota.take("aminata", NOON + 12 * 3600 * 1000)).toBe(true); // 00:00 next day
    expect(quota.take("aminata", NOON + DAY)).toBe(false);
  });
});
