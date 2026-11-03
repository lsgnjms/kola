import { createHash } from "node:crypto";
import { httpAuthTemplate, type CircleView } from "@kola/shared";
import type { FastifyInstance } from "fastify";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, describe, expect, it } from "vitest";
import type { AssistantModel } from "../assistant/claude.js";
import type { AssistantFacts } from "../assistant/facts.js";
import { loadEnv } from "../env.js";
import { buildServer } from "../server.js";

const PUBLIC = "http://localhost:5173/api";
const owner = generateSecretKey();
const friend = generateSecretKey();
const stranger = generateSecretKey();
let app: FastifyInstance;

async function start(assistant: AssistantModel | null) {
  app = await buildServer(loadEnv({ LOG_LEVEL: "fatal", DB_PATH: ":memory:" }), {
    assistant,
    startEngine: false,
    relaySend: async () => {},
  });
}

afterEach(async () => {
  await app.close();
});

async function call<T>(sk: Uint8Array, method: "GET" | "POST", path: string, body?: unknown) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const event = finalizeEvent(
    httpAuthTemplate({
      url: PUBLIC + path,
      method,
      nowS: Math.floor(Date.now() / 1000),
      ...(payload ? { payloadSha256Hex: createHash("sha256").update(payload).digest("hex") } : {}),
    }),
    sk,
  );
  const res = await app.inject({
    method,
    url: path,
    headers: {
      authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { payload } : {}),
  });
  return { status: res.statusCode, json: res.json() as T };
}

async function circleWithTwoMembers(): Promise<string> {
  const created = await call<CircleView>(owner, "POST", "/circles", {
    name: "Marché HLM",
    contributionSat: 1000,
    memberCount: 2,
    nickname: "Aminata",
  });
  await call(friend, "POST", "/circles/join", { joinCode: created.json.joinCode, nickname: "Fatou" });
  return created.json.id;
}

const question = { question: "Who still has to pay?", locale: "fr" };

describe("POST /circles/:id/assistant", () => {
  it("without an API key, tells the app to use its quick answers", async () => {
    await start(null);
    const id = await circleWithTwoMembers();
    const res = await call(owner, "POST", `/circles/${id}/assistant`, question);
    expect(res).toEqual({ status: 503, json: { error: "assistant_unavailable" } });
  });

  it("answers members from an allow-listed summary, never keys or codes", async () => {
    const seen: { facts: AssistantFacts; question: string; locale: string }[] = [];
    await start({ ask: async (input) => (seen.push(input), "Fatou doit encore payer.") });
    const id = await circleWithTwoMembers();

    const res = await call<{ answer: string }>(friend, "POST", `/circles/${id}/assistant`, question);
    expect(res).toEqual({ status: 200, json: { answer: "Fatou doit encore payer." } });
    expect(seen[0]).toMatchObject({ question: "Who still has to pay?", locale: "fr" });
    expect(seen[0]?.facts.askedBy).toBe("Fatou");
    expect(seen[0]?.facts.members.map((m) => m.nickname)).toEqual(["Aminata", "Fatou"]);

    const sent = JSON.stringify(seen[0]?.facts);
    const view = await call<CircleView>(owner, "GET", `/circles/${id}`);
    for (const secret of [getPublicKey(owner), getPublicKey(friend), view.json.joinCode, view.json.coordinatorPubkey]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("refuses people outside the circle, bad input, and model failures", async () => {
    await start({
      ask: async ({ question: q }) => {
        if (q === "boom") throw Object.assign(new Error("upstream"), { status: 529 });
        return q === "decline" ? null : "ok";
      },
    });
    const id = await circleWithTwoMembers();
    expect((await call(stranger, "POST", `/circles/${id}/assistant`, question)).status).toBe(404);
    expect((await call(owner, "POST", `/circles/${id}/assistant`, { question: "", locale: "en" })).status).toBe(400);
    expect((await call(owner, "POST", `/circles/${id}/assistant`, { question: "x".repeat(501), locale: "en" })).status).toBe(400);
    expect((await call(owner, "POST", `/circles/${id}/assistant`, { question: "hi", locale: "de" })).status).toBe(400);
    expect((await call(owner, "POST", `/circles/${id}/assistant`, { question: "boom", locale: "en" })).json).toEqual({
      error: "assistant_unavailable",
    });
    expect((await call(owner, "POST", `/circles/${id}/assistant`, { question: "decline", locale: "en" })).status).toBe(503);
  });
});
