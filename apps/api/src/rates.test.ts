import { describe, expect, it } from "vitest";
import { parseCoingecko, parseMempool, RateFeed, XOF_PER_EUR } from "./rates.js";

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

describe("rate parsing", () => {
  it("reads FCFA and naira from CoinGecko, ignoring junk", () => {
    expect(parseCoingecko({ bitcoin: { xof: 43_000_000, ngn: 100_000_000 } })).toEqual({ XOF: 43_000_000, NGN: 100_000_000 });
    expect(parseCoingecko({ bitcoin: { xof: -1, ngn: "lots" } })).toEqual({});
    expect(parseCoingecko(null)).toEqual({});
  });

  it("derives FCFA from the euro peg on mempool.space", () => {
    expect(parseMempool({ EUR: 66_000 })).toEqual({ XOF: Math.round(66_000 * XOF_PER_EUR) });
    expect(parseMempool({ USD: 1 })).toEqual({});
  });
});

describe("RateFeed", () => {
  it("caches, and keeps the last good rate when the feeds fail", async () => {
    let now = 0;
    let up = true;
    let calls = 0;
    const fetchFn = (async (url: string) => {
      calls++;
      if (!up) throw new Error("offline");
      return url.includes("coingecko") ? json({ bitcoin: { xof: 40_000_000, ngn: 90_000_000 } }) : json({ EUR: 61_000 });
    }) as typeof fetch;
    const feed = new RateFeed(fetchFn, () => now);

    expect((await feed.get()).rates).toEqual({ XOF: 40_000_000, NGN: 90_000_000 });
    await feed.get();
    expect(calls).toBe(2); // second call served from cache

    up = false;
    now += 11 * 60 * 1000;
    expect((await feed.get()).rates).toEqual({ XOF: 40_000_000, NGN: 90_000_000 });
  });

  it("falls back to the euro peg when CoinGecko is down", async () => {
    const fetchFn = (async (url: string) =>
      url.includes("coingecko") ? json(null, false) : json({ EUR: 61_000 })) as typeof fetch;
    expect((await new RateFeed(fetchFn, () => 0).get()).rates).toEqual({ XOF: Math.round(61_000 * XOF_PER_EUR) });
  });

  it("reports no rates (sats only) when everything is unreachable", async () => {
    const feed = new RateFeed((async () => Promise.reject(new Error("offline"))) as typeof fetch, () => 0);
    expect((await feed.get()).rates).toEqual({});
  });
});
