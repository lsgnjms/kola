import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** File paths in .env are relative to the repo root, whatever the process cwd. */
const RepoPath = z
  .string()
  .min(1)
  .transform((p) => (p === ":memory:" || isAbsolute(p) ? p : resolve(REPO_ROOT, p)));

/**
 * "alice=https://localhost:8082,bob=…". Cert and macaroon paths follow the
 * layout the regtest stack and seed script produce under infra/data/<name>/.
 */
const MemberNodes = z
  .string()
  .transform((s) => s.split(",").map((e) => e.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^[a-z0-9-]+=https:\/\/\S+$/)))
  .transform((entries) =>
    entries.map((entry) => {
      const [name = "", restUrl = ""] = entry.split("=");
      return {
        name,
        restUrl,
        tlsCertPath: resolve(REPO_ROOT, "infra/data", name, "tls.cert"),
        macaroonPath: resolve(REPO_ROOT, "infra/data", name, "kola/wallet.macaroon"),
      };
    }),
  );

const Env = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  MAX_PAYMENT_SAT: z.coerce.number().int().positive().default(100_000),
  MAX_DAILY_SPEND_SAT: z.coerce.number().int().positive().default(500_000),
  MAX_PAYOUT_FEE_SAT: z.coerce.number().int().nonnegative().default(50),
  /** The API's URL as the browser sees it; NIP-98 events are signed over it. */
  PUBLIC_API_URLS: z
    .string()
    .default("http://localhost:5173/api")
    .transform((s) => s.split(",").map((u) => u.trim()).filter(Boolean))
    .pipe(z.array(z.string().url()).min(1)),
  BITCOIN_NETWORK: z.enum(["regtest", "signet", "testnet", "mainnet"]).default("regtest"),
  DB_PATH: RepoPath.default("data/kola.sqlite"),
  MEMBER_NODES: MemberNodes.default(
    "alice=https://localhost:8082,bob=https://localhost:8083,carol=https://localhost:8084",
  ),
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
