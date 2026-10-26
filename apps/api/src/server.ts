import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { openDb } from "./db.js";
import type { Env } from "./env.js";
import { walletRoutes } from "./routes/wallet.js";
import { WalletBindings } from "./wallet/bindings.js";
import { MemberWallets, type WalletLoader } from "./wallet/memberWallets.js";

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
  nowMs?: () => number;
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

  const db = openDb(env.DB_PATH);
  app.addHook("onClose", async () => db.close());
  const wallets = new MemberWallets(env.MEMBER_NODES, deps.walletLoader);
  const bindings = new WalletBindings(db, wallets.names());

  app.get("/health", async () => ({
    status: "ok",
    assistant: env.ANTHROPIC_API_KEY ? "ai" : "templated",
  }));

  await app.register(walletRoutes, { env, bindings, wallets, nowMs: deps.nowMs ?? Date.now });

  return app;
}
