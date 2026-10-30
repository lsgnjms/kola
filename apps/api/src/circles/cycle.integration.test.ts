/**
 * Full savings-circle rounds against the regtest stack, through the real HTTP
 * routes with NIP-98 signed requests. Needs `docker compose up` + `pnpm seed`.
 * Run with `pnpm test:integration`.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCircle, buildCircleEvent, CIRCLE_KINDS, circleAddress, httpAuthTemplate, type CircleView } from "@kola/shared";
import type { FastifyInstance } from "fastify";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../env.js";
import { buildServer } from "../server.js";

const PUBLIC = "http://localhost:5173/api";
const WINDOW_S = 30;
const CONTRIBUTION = 1_000;
const FEE_TOLERANCE = 30;

const dir = mkdtempSync(join(tmpdir(), "kola-it-"));
const env = loadEnv({
  LOG_LEVEL: "warn",
  DB_PATH: join(dir, "kola.sqlite"),
  COORDINATOR_PREIMAGE_SECRET: randomBytes(32).toString("hex"),
  CONTRIBUTION_WINDOW_SECONDS: String(WINDOW_S),
});

const keys = { alice: generateSecretKey(), bob: generateSecretKey(), carol: generateSecretKey() };
type Who = keyof typeof keys;
let app: FastifyInstance;

async function call<T>(who: Who, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const event = finalizeEvent(
    httpAuthTemplate({
      url: PUBLIC + path,
      method,
      nowS: Math.floor(Date.now() / 1000),
      ...(payload ? { payloadSha256Hex: createHash("sha256").update(payload).digest("hex") } : {}),
    }),
    keys[who],
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

const balance = async (who: Who) => (await call<{ balanceSat: number }>(who, "GET", "/wallet/balance")).json.balanceSat;

/**
 * Balance once channel updates have finished. LND reports a payment as
 * succeeded when the payer has the preimage; the receiving channel settles a
 * moment later, so wait for two equal reads in a row.
 */
async function settledBalance(who: Who): Promise<number> {
  let last = await balance(who);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 700));
    const next = await balance(who);
    if (next === last) return next;
    last = next;
  }
  throw new Error(`${who} balance never settled`);
}
const circle = async (who: Who, id: string) => (await call<CircleView>(who, "GET", `/circles/${id}`)).json;

async function waitForState(id: string, states: string[], timeoutMs: number): Promise<CircleView> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const view = await circle("alice", id);
    if (view.currentCycle && states.includes(view.currentCycle.state)) return view;
    if (Date.now() > until) throw new Error(`timed out waiting for ${states.join("/")}, at ${view.currentCycle?.state}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let circleId = "";

beforeAll(async () => {
  app = await buildServer(env);
  for (const who of Object.keys(keys) as Who[]) {
    expect((await call(who, "POST", "/wallet/claim")).status).toBe(200);
  }
  const created = await call<CircleView>("alice", "POST", "/circles", {
    name: "Integration tontine",
    contributionSat: CONTRIBUTION,
    memberCount: 3,
    nickname: "Alice",
  });
  expect(created.status).toBe(201);
  circleId = created.json.id;
  await call("bob", "POST", "/circles/join", { joinCode: created.json.joinCode, nickname: "Bob" });
  const joined = await call<CircleView>("carol", "POST", "/circles/join", { joinCode: created.json.joinCode, nickname: "Carol" });
  expect(joined.json.status).toBe("active");

  // Each member signs their own agreement to the rules, as the web app does.
  for (const who of Object.keys(keys) as Who[]) {
    const view = (await circle(who, circleId));
    const event = finalizeEvent(
      buildCircleEvent(
        {
          type: "circle_joined",
          circleId,
          member: getPublicKey(keys[who]),
          contributionSat: view.contributionSat,
          memberCount: view.memberCount,
        },
        { coordinatorPubkey: view.coordinatorPubkey, nowS: Math.floor(Date.now() / 1000) },
      ),
      keys[who],
    );
    const res = await call<CircleView>(who, "POST", `/circles/${circleId}/join-record`, { event });
    expect(res.json.joinRecorded, who).toBe(true);
  }
  // A member can't record a join for someone else.
  const forged = finalizeEvent(
    buildCircleEvent(
      { type: "circle_joined", circleId, member: getPublicKey(keys.bob), contributionSat: CONTRIBUTION, memberCount: 3 },
      { coordinatorPubkey: joined.json.coordinatorPubkey, nowS: Math.floor(Date.now() / 1000) },
    ),
    keys.bob,
  );
  expect((await call("alice", "POST", `/circles/${circleId}/join-record`, { event: forged })).status).toBe(400);
}, 60_000);

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("savings circle on regtest", () => {
  it("happy path: everyone pays, the pot lands with the first recipient", async () => {
    const before = { alice: await settledBalance("alice"), bob: await settledBalance("bob") };

    const opened = await call<CircleView>("alice", "POST", `/circles/${circleId}/cycles`);
    expect(opened.json.currentCycle).toMatchObject({ state: "collecting", recipientPosition: 0, potSat: 3 * CONTRIBUTION });
    expect((await call("bob", "POST", `/circles/${circleId}/cycles`)).status).toBe(403); // only the creator opens rounds

    for (const who of ["alice", "bob", "carol"] as Who[]) {
      const res = await call<{ status: string }>(who, "POST", `/circles/${circleId}/contribute`);
      expect(res.json.status, who).toMatch(/held|already_paid/);
    }
    const done = await waitForState(circleId, ["paid_out"], 30_000);
    expect(done.currentCycle?.contributions.map((c) => c.status)).toEqual(["paid", "paid", "paid"]);

    // Alice paid 1000 and received the 3000 pot; Bob paid 1000 plus a routing fee.
    const alice = (await settledBalance("alice")) - before.alice;
    const bob = (await settledBalance("bob")) - before.bob;
    expect(alice).toBeGreaterThanOrEqual(2 * CONTRIBUTION - FEE_TOLERANCE);
    expect(alice).toBeLessThanOrEqual(2 * CONTRIBUTION);
    expect(bob).toBeGreaterThanOrEqual(-CONTRIBUTION - FEE_TOLERANCE);
    expect(bob).toBeLessThanOrEqual(-CONTRIBUTION);
  }, 90_000);

  it("missed deadline: the round is cancelled and payers get their money back", async () => {
    const before = { alice: await settledBalance("alice"), bob: await settledBalance("bob") };
    const opened = await call<CircleView>("alice", "POST", `/circles/${circleId}/cycles`);
    expect(opened.json.currentCycle).toMatchObject({ cycleIndex: 1, recipientPosition: 1 });

    await call("alice", "POST", `/circles/${circleId}/contribute`);
    await call("bob", "POST", `/circles/${circleId}/contribute`);
    // Carol never pays.
    const view = await waitForState(circleId, ["cancelled"], (WINDOW_S + 20) * 1000);
    expect(view.currentCycle?.contributions.map((c) => c.status)).toEqual(["refunded", "refunded", "refunded"]);

    // Held payments that are cancelled cost nothing: balances are exactly restored.
    expect(await settledBalance("alice")).toBe(before.alice);
    expect(await settledBalance("bob")).toBe(before.bob);
  }, 120_000);

  it("API restart mid-round: a new server picks the round up and completes it", async () => {
    const opened = await call<CircleView>("alice", "POST", `/circles/${circleId}/cycles`);
    expect(opened.json.currentCycle).toMatchObject({ cycleIndex: 1, attempt: 2 });
    await call("alice", "POST", `/circles/${circleId}/contribute`);
    await call("bob", "POST", `/circles/${circleId}/contribute`);

    await app.close();
    app = await buildServer(env); // same DB file and preimage secret, new process state

    const res = await call<{ status: string }>("carol", "POST", `/circles/${circleId}/contribute`);
    expect(res.json.status).toMatch(/held|already_paid/);
    const done = await waitForState(circleId, ["paid_out"], 30_000);
    expect(done.completedCycles).toBe(2);
  }, 90_000);

  it("public record: every round is on the relay, verifies, and carries no names", async () => {
    const view = await circle("alice", circleId);
    const relay = await Relay.connect("ws://127.0.0.1:7777");
    const readRecord = () =>
      new Promise<unknown[]>((resolve) => {
        const events: unknown[] = [];
        const sub = relay.subscribe(
          [{ kinds: [...CIRCLE_KINDS], "#a": [circleAddress(view.coordinatorPubkey, circleId)] }],
          {
            onevent: (e) => events.push(e),
            oneose: () => {
              sub.close();
              resolve(events);
            },
          },
        );
      });
    const expected = { circleId, coordinatorPubkey: view.coordinatorPubkey };

    // Delivery is asynchronous: wait for the last round's payout to reach the relay.
    let raw: unknown[] = [];
    for (let i = 0; i < 40; i++) {
      raw = await readRecord();
      const payouts = auditCircle(raw, expected).entries.filter((e) => e.event.type === "payout_sent");
      if (payouts.length === 2) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    relay.close();

    const { entries, problems } = auditCircle(raw, expected);
    expect(problems).toEqual([]);
    const count = (type: string) => entries.filter((e) => e.event.type === type).length;
    expect(count("circle_defined")).toBe(1);
    expect(count("circle_joined")).toBe(3);
    expect(count("cycle_opened")).toBe(3); // round 1, round 2 cancelled, round 2 retried
    expect(count("cycle_cancelled")).toBe(1);
    expect(count("contribution_settled")).toBe(6);
    expect(count("payout_sent")).toBe(2);

    const onTheWire = JSON.stringify(raw);
    for (const secret of ["Integration tontine", "Alice", "Bob", "Carol", view.joinCode]) {
      expect(onTheWire, secret).not.toContain(secret);
    }
  }, 60_000);
});
