import { createHash } from "node:crypto";
import { HTTP_AUTH_MAX_SKEW_S, verifyHttpAuthEvent, type PubkeyHex } from "@kola/shared";
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Exact request body, kept so NIP-98 can check the signed payload hash. */
    rawBody?: string;
    /** Set by `nostrAuth` once the request signature is verified. */
    memberPubkey?: PubkeyHex;
  }
}

const MAX_HEADER_BYTES = 8 * 1024;

/**
 * NIP-98 auth. The signed `u` tag must match `publicApiUrl` + the request path,
 * i.e. the URL the browser called (through the dev proxy or a reverse proxy).
 * Each signed header is accepted once, so a captured one can't be replayed.
 */
export function nostrAuth(opts: { publicApiUrls: readonly string[]; nowS: () => number }): preHandlerAsyncHookHandler {
  const bases = opts.publicApiUrls.map((u) => u.replace(/\/+$/, ""));
  const seen = new Map<string, number>();

  return async function verify(request: FastifyRequest, reply: FastifyReply) {
    const nowS = opts.nowS();
    const event = parseHeader(request.headers.authorization);
    if (!event) return deny(reply);

    const body = request.rawBody;
    const payload = body ? { payloadSha256Hex: createHash("sha256").update(body, "utf8").digest("hex") } : {};
    // Try each configured public URL (e.g. localhost and the LAN address for phone testing).
    let result: ReturnType<typeof verifyHttpAuthEvent> = { ok: false, reason: "wrong_url" };
    for (const base of bases) {
      result = verifyHttpAuthEvent(event, { url: base + request.url, method: request.method, nowS, ...payload });
      if (result.ok || result.reason !== "wrong_url") break;
    }
    if (!result.ok) {
      request.log.debug({ reason: result.reason }, "nostr auth rejected");
      return deny(reply);
    }

    // Keyed on the signature, not the event id: two identical requests in the same
    // second share an id, but BIP-340 signatures are randomized, so only a copied
    // header repeats one.
    for (const [sig, expiresS] of seen) if (expiresS < nowS) seen.delete(sig);
    if (seen.has(result.sig)) {
      request.log.debug({ reason: "replay" }, "nostr auth rejected");
      return deny(reply);
    }
    seen.set(result.sig, nowS + 2 * HTTP_AUTH_MAX_SKEW_S);

    request.memberPubkey = result.pubkey;
  };
}

function parseHeader(header: string | undefined): unknown {
  if (!header || header.length > MAX_HEADER_BYTES) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Nostr" || !token) return null;
  try {
    return JSON.parse(Buffer.from(token, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function deny(reply: FastifyReply) {
  return reply.code(401).send({ error: "unauthorized" });
}
