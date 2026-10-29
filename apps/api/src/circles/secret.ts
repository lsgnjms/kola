import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The coordinator's preimage-derivation secret. Order: env var, then a file next
 * to the database (created on first start, owner-only), then (in-memory DB,
 * i.e. tests) a throwaway random key.
 */
export function loadPreimageSecret(env: { COORDINATOR_PREIMAGE_SECRET?: string | undefined; DB_PATH: string }): Buffer {
  if (env.COORDINATOR_PREIMAGE_SECRET) return Buffer.from(env.COORDINATOR_PREIMAGE_SECRET, "hex");
  if (env.DB_PATH === ":memory:") return randomBytes(32);

  const path = join(dirname(env.DB_PATH), "coordinator-preimage.secret");
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  const hex = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("coordinator preimage secret file is corrupt");
  return Buffer.from(hex, "hex");
}
