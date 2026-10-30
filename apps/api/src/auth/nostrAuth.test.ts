import { httpAuthTemplate } from "@kola/shared";
import Fastify from "fastify";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { nostrAuth } from "./nostrAuth.js";

const NOW_S = 1_700_000_000;
const sk = generateSecretKey();

async function appWith(publicApiUrls: string[]) {
  const app = Fastify();
  app.addHook("preHandler", nostrAuth({ publicApiUrls, nowS: () => NOW_S }));
  app.get("/wallet/balance", async (req) => ({ pubkey: req.memberPubkey }));
  await app.ready();
  return app;
}

const signedFor = (url: string) =>
  `Nostr ${btoa(JSON.stringify(finalizeEvent(httpAuthTemplate({ url, method: "GET", nowS: NOW_S }), sk)))}`;

describe("nostrAuth public URLs", () => {
  it("accepts requests signed for any configured URL (localhost or LAN)", async () => {
    const app = await appWith(["http://localhost:5173/api", "http://10.0.0.5:5173/api/"]);
    for (const base of ["http://localhost:5173/api", "http://10.0.0.5:5173/api"]) {
      const res = await app.inject({
        method: "GET",
        url: "/wallet/balance",
        headers: { authorization: signedFor(`${base}/wallet/balance`) },
      });
      expect(res.statusCode, base).toBe(200);
    }
  });

  it("rejects requests signed for an unconfigured host", async () => {
    const app = await appWith(["http://localhost:5173/api"]);
    const res = await app.inject({
      method: "GET",
      url: "/wallet/balance",
      headers: { authorization: signedFor("http://evil.example/api/wallet/balance") },
    });
    expect(res.statusCode).toBe(401);
  });
});
