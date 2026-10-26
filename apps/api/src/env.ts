import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** File paths in .env are relative to the repo root, whatever the process cwd. */
const RepoPath = z
  .string()
  .min(1)
  .transform((p) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p)));

const Env = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  MAX_PAYMENT_SAT: z.coerce.number().int().positive().default(100_000),
  MAX_DAILY_SPEND_SAT: z.coerce.number().int().positive().default(500_000),
  MAX_PAYOUT_FEE_SAT: z.coerce.number().int().nonnegative().default(50),
  NOSTR_RELAY_URL: z.string().url().default("ws://localhost:7777"),
  COORDINATOR_LND_REST_URL: z.string().url().default("https://localhost:8081"),
  COORDINATOR_LND_TLS_CERT_PATH: RepoPath.default("infra/data/coordinator/tls.cert"),
  COORDINATOR_INVOICE_MACAROON_PATH: RepoPath.default("infra/data/coordinator/kola/invoice.macaroon"),
  COORDINATOR_PAYOUT_MACAROON_PATH: RepoPath.default("infra/data/coordinator/kola/payout.macaroon"),
  // Optional: without it the assistant uses templated answers.
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type Env = z.infer<typeof Env>;

/** Parses the environment. Error messages name the variable but never echo its value. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = Env.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`invalid environment: ${fields}`);
  }
  return result.data;
}
