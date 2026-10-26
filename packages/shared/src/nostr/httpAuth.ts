import { verifyEvent, type Event, type EventTemplate } from "nostr-tools/pure";
import { z } from "zod";
import { PubkeyHex } from "../schemas.js";
import { NIP_KIND } from "./kinds.js";

/**
 * NIP-98 HTTP Auth. The web app signs one event per request with the member's
 * on-device key; the API verifies it. The server never sees the private key.
 */

export const HTTP_AUTH_MAX_SKEW_S = 60;

export function httpAuthTemplate(input: {
  url: string;
  method: string;
  nowS: number;
  /** sha256 of the exact request body bytes, hex. Omit for requests without a body. */
  payloadSha256Hex?: string;
}): EventTemplate {
  const tags = [
    ["u", input.url],
    ["method", input.method.toUpperCase()],
  ];
  if (input.payloadSha256Hex) tags.push(["payload", input.payloadSha256Hex]);
  return { kind: NIP_KIND.HTTP_AUTH, created_at: input.nowS, tags, content: "" };
}

const Hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`));

const SignedEvent = z.object({
  id: Hex(32),
  pubkey: PubkeyHex,
  sig: Hex(64),
  kind: z.number().int(),
  created_at: z.number().int(),
  tags: z.array(z.array(z.string()).max(10)).max(20),
  content: z.string().max(1024),
});

export type HttpAuthFailure =
  | "malformed"
  | "wrong_kind"
  | "bad_signature"
  | "stale"
  | "wrong_url"
  | "wrong_method"
  | "wrong_payload";

export function verifyHttpAuthEvent(
  raw: unknown,
  expected: { url: string; method: string; nowS: number; payloadSha256Hex?: string },
): { ok: true; pubkey: PubkeyHex; sig: string } | { ok: false; reason: HttpAuthFailure } {
  const parsed = SignedEvent.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const event: Event = parsed.data;

  if (event.kind !== NIP_KIND.HTTP_AUTH) return { ok: false, reason: "wrong_kind" };
  if (Math.abs(expected.nowS - event.created_at) > HTTP_AUTH_MAX_SKEW_S) return { ok: false, reason: "stale" };
  if (tag(event, "u") !== expected.url) return { ok: false, reason: "wrong_url" };
  if (tag(event, "method") !== expected.method.toUpperCase()) return { ok: false, reason: "wrong_method" };
  // A body must be covered by the signature, otherwise it could be swapped in transit.
  if (expected.payloadSha256Hex !== undefined && tag(event, "payload") !== expected.payloadSha256Hex) {
    return { ok: false, reason: "wrong_payload" };
  }
  // Signature last: cheap checks first.
  if (!verifyEvent(event)) return { ok: false, reason: "bad_signature" };
  return { ok: true, pubkey: event.pubkey, sig: event.sig };
}

function tag(event: Event, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}
