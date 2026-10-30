import { randomInt, randomUUID } from "node:crypto";
import {
  auditCircle,
  CreateCircleRequest,
  eventKey,
  JOIN_CODE_ALPHABET,
  JoinCircleRequest,
  potSat,
  RecordJoinRequest,
  type CircleView,
  type ContributionStatus,
  type HoldInvoiceState,
} from "@kola/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { memberPubkey, nostrAuth } from "../auth/nostrAuth.js";
import { contribute } from "../circles/contribute.js";
import { EngineError, type CycleEngine } from "../circles/engine.js";
import type { NostrPublisher } from "../circles/publisher.js";
import type { CircleRow, CircleStore } from "../circles/store.js";
import type { Env } from "../env.js";
import type { WalletProvider } from "../wallet/WalletProvider.js";
import { PAY_ERROR_STATUS, walletFor, type WalletRouteDeps } from "./wallet.js";

export interface CircleRouteDeps extends Pick<WalletRouteDeps, "bindings" | "wallets" | "payLock"> {
  env: Env;
  store: CircleStore;
  engine: CycleEngine;
  publisher: NostrPublisher;
  coordinator: () => Promise<WalletProvider>;
  nowMs: () => number;
}

const CircleIdParams = z.object({ id: z.string().uuid() });

const ENGINE_ERROR_STATUS: Record<EngineError["code"], number> = {
  circle_not_found: 404,
  circle_not_ready: 409,
  cycle_in_progress: 409,
  circle_complete: 409,
};

const CONTRIBUTION_STATUS: Record<HoldInvoiceState, ContributionStatus> = {
  OPEN: "unpaid",
  ACCEPTED: "held",
  SETTLED: "paid",
  CANCELED: "refunded",
};

/**
 * Savings circles. NIP-98 authenticated; a member only ever sees circles they
 * belong to (others get 404, so circle ids don't leak existence). Cycle state
 * changes only happen inside the engine.
 */
export async function circleRoutes(app: FastifyInstance, deps: CircleRouteDeps): Promise<void> {
  const { store } = deps;
  app.addHook(
    "preHandler",
    nostrAuth({ publicApiUrls: deps.env.PUBLIC_API_URLS, nowS: () => Math.floor(deps.nowMs() / 1000) }),
  );

  app.post("/circles", async (request, reply) => {
    const body = CreateCircleRequest.safeParse(request.body);
    if (!body.success || body.data.contributionSat > deps.env.MAX_PAYMENT_SAT) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const me = memberPubkey(request);
    const circle: CircleRow = {
      id: randomUUID(),
      name: body.data.name,
      contributionSat: body.data.contributionSat,
      memberCount: body.data.memberCount,
      periodSeconds: 7 * 24 * 3600,
      creatorPubkey: me,
      joinCode: newJoinCode(store),
      status: "forming",
      createdAtMs: deps.nowMs(),
    };
    store.createCircle(circle);
    store.addMember(circle.id, me, body.data.nickname, deps.nowMs());
    return reply.code(201).send(view(circle, me));
  });

  app.post("/circles/join", async (request, reply) => {
    const body = JoinCircleRequest.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const me = memberPubkey(request);
    const circle = store.getCircleByJoinCode(body.data.joinCode);
    if (!circle) return reply.code(404).send({ error: "circle_not_found" });

    const members = store.members(circle.id);
    if (members.some((m) => m.pubkey === me)) return view(circle, me); // Joining twice is fine.
    if (circle.status !== "forming" || members.length >= circle.memberCount) {
      return reply.code(409).send({ error: "circle_full" });
    }
    // Synchronous SQLite: nothing can interleave between the check above and these writes.
    store.addMember(circle.id, me, body.data.nickname, deps.nowMs());
    if (members.length + 1 === circle.memberCount) {
      store.setCircleStatus(circle.id, "active");
      await announceDefinition(circle);
    }
    return view(store.getCircle(circle.id) ?? circle, me);
  });

  app.get("/circles", async (request) => {
    const me = memberPubkey(request);
    return {
      circles: store.circlesFor(me).map((c) => ({
        id: c.id,
        name: c.name,
        contributionSat: c.contributionSat,
        memberCount: c.memberCount,
        membersJoined: store.members(c.id).length,
        status: c.status,
      })),
    };
  });

  app.get("/circles/:id", async (request, reply) => {
    const circle = myCircle(request.params, memberPubkey(request), reply);
    if (!circle) return;
    return view(circle, memberPubkey(request));
  });

  /** Publishes the member's own signed agreement to the rules. The server can't forge these. */
  app.post("/circles/:id/join-record", async (request, reply) => {
    const me = memberPubkey(request);
    const circle = myCircle(request.params, me, reply);
    if (!circle) return;
    const body = RecordJoinRequest.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    const { entries } = auditCircle([body.data.event], {
      circleId: circle.id,
      coordinatorPubkey: deps.publisher.coordinatorPubkey,
    });
    const event = entries[0]?.event;
    if (
      event?.type !== "circle_joined" ||
      event.member !== me ||
      event.contributionSat !== circle.contributionSat ||
      event.memberCount !== circle.memberCount
    ) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    // auditCircle checked the shape and the signature, so this is a complete signed event.
    deps.publisher.addSigned(eventKey(event), body.data.event as Parameters<NostrPublisher["addSigned"]>[1]);
    if (circle.status !== "forming") await announceDefinition(circle);
    return view(circle, me);
  });

  /** Opens the next round. Only the creator can, so a member can't spam rounds. */
  app.post("/circles/:id/cycles", async (request, reply) => {
    const me = memberPubkey(request);
    const circle = myCircle(request.params, me, reply);
    if (!circle) return;
    if (circle.creatorPubkey !== me) return reply.code(403).send({ error: "not_creator" });
    try {
      await deps.engine.openNextCycle(circle.id);
    } catch (err) {
      if (err instanceof EngineError) return reply.code(ENGINE_ERROR_STATUS[err.code]).send({ error: err.code });
      throw err;
    }
    return view(store.getCircle(circle.id) ?? circle, me);
  });

  /** Pays my share of the open round from my wallet. */
  app.post(
    "/circles/:id/contribute",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const me = memberPubkey(request);
      const circle = myCircle(request.params, me, reply);
      if (!circle) return;
      const wallet = await walletFor(deps, request, reply);
      if (!wallet) return;

      try {
        const outcome = await deps.payLock.run(me, () =>
          contribute({ store, engine: deps.engine, coordinator: deps.coordinator, log: request.log }, wallet, circle.id, me, {
            network: deps.env.BITCOIN_NETWORK,
            nowMs: deps.nowMs(),
            caps: { maxPaymentSat: deps.env.MAX_PAYMENT_SAT, maxDailySat: deps.env.MAX_DAILY_SPEND_SAT },
          }),
        );
        if (outcome.ok) return { status: outcome.status };
        const status =
          outcome.error === "no_open_cycle" ? 409 : outcome.error === "not_a_member" ? 404 : PAY_ERROR_STATUS[outcome.error];
        return reply.code(status).send({ error: outcome.error, moneyMoved: false });
      } catch (err) {
        request.log.error({ err }, "contribution outcome unknown");
        return reply.code(503).send({ error: "payment_status_unknown", moneyMoved: null });
      }
    },
  );

  /** Idempotent. Pubkeys and amounts only: the circle's name and nicknames stay off the relay. */
  async function announceDefinition(circle: CircleRow): Promise<void> {
    await deps.publisher.publish({
      type: "circle_defined",
      circleId: circle.id,
      definition: {
        id: circle.id,
        contributionSat: circle.contributionSat,
        periodSeconds: circle.periodSeconds,
        memberCount: circle.memberCount,
        coordinatorPubkey: deps.publisher.coordinatorPubkey,
        rotation: store.members(circle.id).map((m) => m.pubkey),
      },
    });
  }

  function myCircle(params: unknown, me: string, reply: FastifyReply): CircleRow | null {
    const parsed = CircleIdParams.safeParse(params);
    const circle = parsed.success ? store.getCircle(parsed.data.id) : null;
    if (!circle || !store.members(circle.id).some((m) => m.pubkey === me)) {
      void reply.code(404).send({ error: "circle_not_found" });
      return null;
    }
    return circle;
  }

  function view(circle: CircleRow, me: string): CircleView {
    const members = store.members(circle.id);
    const position = new Map(members.map((m) => [m.pubkey, m.position]));
    const latest = store.latestCycle(circle.id);
    return {
      id: circle.id,
      name: circle.name,
      contributionSat: circle.contributionSat,
      memberCount: circle.memberCount,
      status: circle.status,
      joinCode: circle.joinCode,
      isCreator: circle.creatorPubkey === me,
      coordinatorPubkey: deps.publisher.coordinatorPubkey,
      joinRecorded: deps.publisher.has(
        eventKey({
          type: "circle_joined",
          circleId: circle.id,
          member: me,
          contributionSat: circle.contributionSat,
          memberCount: circle.memberCount,
        }),
      ),
      members: members.map((m) => ({
        position: m.position,
        pubkey: m.pubkey,
        nickname: m.nickname,
        isYou: m.pubkey === me,
        isCreator: m.pubkey === circle.creatorPubkey,
      })),
      completedCycles: store.paidOutCount(circle.id),
      currentCycle: latest && {
        cycleIndex: latest.cycleIndex,
        attempt: latest.attempt,
        state: latest.state,
        recipientPosition: position.get(latest.recipientPubkey) ?? 0,
        deadlineMs: latest.deadlineMs,
        potSat: potSat(circle.contributionSat, circle.memberCount),
        contributions: store.contributions(latest).map((c) => ({
          position: position.get(c.memberPubkey) ?? 0,
          status: CONTRIBUTION_STATUS[c.state],
        })),
      },
    };
  }
}

function newJoinCode(store: CircleStore): string {
  for (;;) {
    const code = Array.from({ length: 6 }, () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)]).join("");
    if (!store.getCircleByJoinCode(code)) return code;
  }
}
