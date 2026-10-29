import { createHash } from "node:crypto";
import { verifyHttpAuthEvent } from "@kola/shared";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "./client.js";

const sk = generateSecretKey();
const NOW = 1_700_000_000_000;
const BASE = "http://localhost:5173/api";

function client(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = new ApiClient({
    baseUrl: `${BASE}/`,
    sign: (template) => finalizeEvent(template, sk),
    nowMs: () => NOW,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as typeof fetch,
  });
  return { api, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Checks the request the way the API's nostrAuth does. */
function verifyRequest(call: { url: string; init: RequestInit }) {
  const header = (call.init.headers as Record<string, string>).authorization ?? "";
  const event = JSON.parse(atob(header.replace(/^Nostr /, ""))) as unknown;
  const body = call.init.body as string | undefined;
  return verifyHttpAuthEvent(event, {
    url: call.url,
    method: call.init.method ?? "GET",
    nowS: NOW / 1000,
    ...(body ? { payloadSha256Hex: createHash("sha256").update(body).digest("hex") } : {}),
  });
}

describe("ApiClient", () => {
  it("signs GET requests the server will accept", async () => {
    const { api, calls } = client(() => json(200, { balanceSat: 42 }));
    expect(await api.balance()).toEqual({ balanceSat: 42 });
    expect(calls[0]?.url).toBe(`${BASE}/wallet/balance`);
    expect(verifyRequest(only(calls))).toMatchObject({ ok: true, pubkey: getPublicKey(sk) });
  });

  it("signs POST bodies so they can't be swapped", async () => {
    const { api, calls } = client(() => json(200, { paymentRequest: "lnbcrt1x", expiresInSeconds: 3600 }));
    await api.createInvoice(500);
    expect(calls[0]?.init.body).toBe('{"amountSat":500}');
    expect(verifyRequest(only(calls))).toMatchObject({ ok: true });
    expect(verifyRequest({ ...only(calls), init: { ...only(calls).init, body: '{"amountSat":9}' } })).toMatchObject({
      ok: false,
      reason: "wrong_payload",
    });
  });

  it("surfaces API errors with whether money moved", async () => {
    const { api } = client(() => json(403, { error: "over_daily_cap", moneyMoved: false }));
    await expect(api.pay("lnbcrt1x")).rejects.toMatchObject({ code: "over_daily_cap", moneyMoved: false });
  });

  it("treats a dropped connection during payment as unknown, elsewhere as plain network", async () => {
    const { api } = client(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(api.pay("lnbcrt1x")).rejects.toMatchObject({ code: "network", moneyMoved: null });
    await expect(api.balance()).rejects.toMatchObject({ code: "network", moneyMoved: undefined });
  });

  it("rejects responses that don't match the contract", async () => {
    const { api } = client(() => json(200, { balanceSat: -1 }));
    await expect(api.balance()).rejects.toBeInstanceOf(ApiError);
  });
});

function only<T>(calls: T[]): T {
  const [call] = calls;
  if (!call) throw new Error("expected a request");
  return call;
}
