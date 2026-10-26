import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { httpAuthTemplate, verifyHttpAuthEvent } from "./httpAuth.js";

const sk = generateSecretKey();
const url = "http://localhost:5173/api/wallet/pay";
const now = 1_700_000_000;
const payload = "ab".repeat(32);

const signed = (overrides: Partial<Parameters<typeof httpAuthTemplate>[0]> = {}) =>
  finalizeEvent(httpAuthTemplate({ url, method: "post", nowS: now, payloadSha256Hex: payload, ...overrides }), sk);

const expected = { url, method: "POST", nowS: now, payloadSha256Hex: payload };

describe("verifyHttpAuthEvent", () => {
  it("accepts a valid event and returns the signer", () => {
    expect(verifyHttpAuthEvent(signed(), expected)).toMatchObject({ ok: true, pubkey: getPublicKey(sk) });
  });

  it("rejects tampered events", () => {
    const event = { ...signed(), created_at: now + 1 };
    expect(verifyHttpAuthEvent(event, expected)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects stale events", () => {
    expect(verifyHttpAuthEvent(signed({ nowS: now - 61 }), expected)).toEqual({ ok: false, reason: "stale" });
  });

  it("binds the event to url, method and body", () => {
    expect(verifyHttpAuthEvent(signed({ url: `${url}x` }), expected)).toMatchObject({ reason: "wrong_url" });
    expect(verifyHttpAuthEvent(signed({ method: "GET" }), expected)).toMatchObject({ reason: "wrong_method" });
    expect(verifyHttpAuthEvent(signed({ payloadSha256Hex: "cd".repeat(32) }), expected)).toMatchObject({
      reason: "wrong_payload",
    });
  });

  it("rejects garbage", () => {
    expect(verifyHttpAuthEvent("nope", expected)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyHttpAuthEvent({ ...signed(), kind: 1 }, expected)).toEqual({ ok: false, reason: "wrong_kind" });
  });
});
