import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { openDb } from "./db.js";
import type { Env } from "./env.js";
import { walletRoutes } from "./routes/wallet.js";
import { WalletBindings } from "./wallet/bindings.js";
import { MemberWallets, type WalletLoader } from "./wallet/memberWallets.js";
import { CycleEngine } from "./circles/engine.js";
import { NostrPublisher, type RelaySend } from "./circles/publisher.js";
import { relaySender } from "./circles/relaySender.js";
import { loadCoordinatorKey, loadPreimageSecret } from "./circles/secret.js";
import { CircleStore } from "./circles/store.js";
import { circleRoutes } from "./routes/circles.js";
import { lndWalletFromFiles } from "./wallet/lnd/fromFiles.js";
import { KeyedMutex } from "./wallet/spendCaps.js";
import type { WalletProvider } from "./wallet/WalletProvider.js";

/**
 * Log redaction: invoices, preimages, macaroons, keys and PII must never be logged.
 * Routes should still avoid putting them on the request object in the first place.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['grpc-metadata-macaroon']",
  "*.invoice",
  "*.paymentRequest",
  "*.preimage",
  "*.macaroon",
  "*.nsec",
  "*.name",
  "*.phone",
];

export interface ServerDeps {
  /** Overrides for tests. */
  walletLoader?: WalletLoader;
  coordinatorLoader?: () => Promise<WalletProvider>;
  relaySend?: RelaySend;
  nowMs?: () => number;
  /** Run the cycle engine ticker (default true). Tests drive the engine directly. */
  startEngine?: boolean;
}

export async function buildServer(env: Env, deps: ServerDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    },
    bodyLimit: 64 * 1024,
  });

  // Keep the exact body bytes: NIP-98 signs their hash.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const text = body as string;
    request.rawBody = text;
    try {
      done(null, text ? JSON.parse(text) : undefined);
    } catch {
      done(Object.assign(new Error("invalid JSON"), { statusCode: 400 }), undefined);
    }
  });

  // Never leak internals: clients get a stable error code only.
  app.setErrorHandler((err: { statusCode?: number }, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error({ err }, "request failed");
    const error = status === 429 ? "rate_limited" : status < 500 ? "invalid_request" : "internal";
    return reply.code(status).send({ error });
  });

  await app.register(cors, { origin: env.CORS_ORIGINS });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  const nowMs = deps.nowMs ?? Date.now;
  const db = openDb(env.DB_PATH);
  const wallets = new MemberWallets(env.MEMBER_NODES, deps.walletLoader);
  const bindings = new WalletBindings(db, wallets.names());
  const payLock = new KeyedMutex();
  const store = new CircleStore(db);
  const coordinator = cached(
    deps.coordinatorLoader ??
      (() =>
        lndWalletFromFiles({
          restUrl: env.COORDINATOR_LND_REST_URL,
          tlsCertPath: env.COORDINATOR_LND_TLS_CERT_PATH,
          invoiceMacaroonPath: env.COORDINATOR_INVOICE_MACAROON_PATH,
          payoutMacaroonPath: env.COORDINATOR_PAYOUT_MACAROON_PATH,
        })),
  );
  const publisher = new NostrPublisher({
    db,
    secretKey: loadCoordinatorKey(env),
    send: deps.relaySend ?? relaySender(env.NOSTR_RELAY_URL),
    nowS: () => Math.floor(nowMs() / 1000),
    log: app.log,
  });
  const engine = new CycleEngine({
    store,
    coordinator,
    // Demo custody: the recipient's wallet node issues the payout invoice. With NWC the member's own wallet would.
    payoutInvoice: async (recipientPubkey, amountSat) => {
      const node = bindings.nodeFor(recipientPubkey);
      if (!node) throw new Error("recipient has no wallet");
      const wallet = await wallets.get(node);
      return (await wallet.createInvoice({ amountSat, expirySeconds: 600, memo: "Kola" })).paymentRequest;
    },
    publisher,
    preimageSecret: loadPreimageSecret(env),
    network: env.BITCOIN_NETWORK,
    nowMs,
    log: app.log,
    config: {
      contributionWindowMs: env.CONTRIBUTION_WINDOW_SECONDS * 1000,
      cltvExpiryDelta: 80,
      maxPayoutFeeSat: env.MAX_PAYOUT_FEE_SAT,
      payoutRetryBaseMs: 5_000,
      payoutRetryMaxMs: 10 * 60_000,
    },
  });
  if (deps.startEngine ?? true) {
    engine.start();
    publisher.start();
  }
  app.addHook("onClose", async () => {
    engine.stop();
    publisher.stop();
    db.close();
  });

  app.get("/health", async () => ({
    status: "ok",
    assistant: env.ANTHROPIC_API_KEY ? "ai" : "templated",
  }));

  await app.register(walletRoutes, { env, bindings, wallets, payLock, nowMs });
  await app.register(circleRoutes, { env, bindings, wallets, payLock, store, engine, coordinator, publisher, nowMs });

  return app;
}

/** Connects on first use and caches; a failed connection is retried on the next call. */
function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}
