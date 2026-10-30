import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface SecretEnv {
  COORDINATOR_PREIMAGE_SECRET?: string | undefined;
  COORDINATOR_NSEC?: string | undefined;
  DB_PATH: string;
}

/** Secret that hold-invoice preimages are derived from. */
export function loadPreimageSecret(env: SecretEnv): Buffer {
  return loadSecret(env.COORDINATOR_PREIMAGE_SECRET, env.DB_PATH, "coordinator-preimage.secret");
}

/** Key that signs the coordinator's public record. */
export function loadCoordinatorKey(env: SecretEnv): Uint8Array {
  return new Uint8Array(loadSecret(env.COORDINATOR_NSEC, env.DB_PATH, "coordinator-nostr.secret"));
}

/**
 * Order: env var, then a file next to the database (created on first start,
 * owner-only), then (in-memory DB, i.e. tests) a throwaway random key.
 */
function loadSecret(value: string | undefined, dbPath: string, fileName: string): Buffer {
  if (value) return Buffer.from(value, "hex");
  if (dbPath === ":memory:") return randomBytes(32);

  const path = join(dirname(dbPath), fileName);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  const hex = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`${fileName} is corrupt`);
  return Buffer.from(hex, "hex");
}
