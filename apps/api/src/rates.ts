import type { FiatRates } from "@kola/shared";

/** The CFA franc is pegged to the euro, so a BTC/EUR price gives an exact BTC/XOF. */
export const XOF_PER_EUR = 655.957;
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;

const COINGECKO = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=xof,ngn";
const MEMPOOL = "https://mempool.space/api/v1/prices";

/** Turns a feed response into prices per whole bitcoin. Pure: unknown shapes give an empty result. */
export function parseCoingecko(json: unknown): FiatRates {
  const btc = (json as { bitcoin?: { xof?: unknown; ngn?: unknown } } | null)?.bitcoin;
  return {
    ...(isPrice(btc?.xof) ? { XOF: btc.xof } : {}),
    ...(isPrice(btc?.ngn) ? { NGN: btc.ngn } : {}),
  };
}

export function parseMempool(json: unknown): FiatRates {
  const eur = (json as { EUR?: unknown } | null)?.EUR;
  return isPrice(eur) ? { XOF: Math.round(eur * XOF_PER_EUR) } : {};
}

function isPrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Indicative local-currency prices for the UI, fetched by the server so phones
 * never contact a third party. Cached; on failure it keeps the last good rates
 * (or none, and the app shows sats only). Never used for any money decision.
 */
export class RateFeed {
  private rates: FiatRates = {};
  private fetchedAtMs = 0;
  private nextRefreshMs = 0;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async get(): Promise<{ rates: FiatRates; fetchedAtMs: number }> {
    if (this.nowMs() >= this.nextRefreshMs) {
      this.pending ??= this.refresh().finally(() => {
        this.pending = null;
      });
      await this.pending;
    }
    return { rates: this.rates, fetchedAtMs: this.fetchedAtMs };
  }

  private async refresh(): Promise<void> {
    const fresh = { ...parseMempool(await this.fetchJson(MEMPOOL)), ...parseCoingecko(await this.fetchJson(COINGECKO)) };
    // Only replace what we got; a failed feed must not erase a good earlier rate.
    if (Object.keys(fresh).length > 0) {
      this.rates = { ...this.rates, ...fresh };
      this.fetchedAtMs = this.nowMs();
      this.nextRefreshMs = this.fetchedAtMs + CACHE_MS;
    } else {
      // Feeds down: retry in a minute, not on every request.
      this.nextRefreshMs = this.nowMs() + 60_000;
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }
}
