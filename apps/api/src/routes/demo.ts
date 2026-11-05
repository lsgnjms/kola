import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Env } from "../env.js";

/** Same people, order and files as scripts/demo.ts. */
const DEMO_PEOPLE = [
  { nickname: "Aminata", role: "organizer" },
  { nickname: "Fatou", role: "member" },
  { nickname: "Moussa", role: "member" },
] as const;

/**
 * Demo identities for the welcome screen, so judges can try Kola in one tap.
 * These are regtest throwaway keys with a published PIN; the route exists only
 * when DEMO_MODE is on AND the network is regtest, never anywhere real money is.
 */
export async function demoRoutes(app: FastifyInstance, { env }: { env: Env }): Promise<void> {
  const enabled = env.DEMO_MODE && env.BITCOIN_NETWORK === "regtest";
  const demoDir = join(dirname(env.DB_PATH), "demo");

  app.get("/demo/people", async (_request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "invalid_request" });
    const people = DEMO_PEOPLE.flatMap(({ nickname, role }) => {
      const file = join(demoDir, `${nickname.toLowerCase()}.txt`);
      return existsSync(file) ? [{ nickname, role, backup: readFileSync(file, "utf8").trim() }] : [];
    });
    return { people };
  });
}
