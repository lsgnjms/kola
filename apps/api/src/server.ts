import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Env } from "./env.js";

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

export async function buildServer(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    },
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, { origin: env.CORS_ORIGINS });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  app.get("/health", async () => ({
    status: "ok",
    assistant: env.ANTHROPIC_API_KEY ? "ai" : "templated",
  }));

  return app;
}
