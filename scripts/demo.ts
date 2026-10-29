/**
 * Demo state: three members (Aminata, Fatou, Moussa) with funded regtest
 * wallets in an active circle, round 1 ready to start. Writes each member's
 * backup code (PIN 123456) to data/demo/ so demo phones can "Restore from a backup".
 *
 *   pnpm demo         create it (no-op if it already exists)
 *   pnpm demo:reset   wipe circles + wallet links, then create it (stop `pnpm dev` first)
 *
 * Regtest throwaway keys only. Never use this PIN or these codes for anything real.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import * as nip49 from "nostr-tools/nip49";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { CircleStore } from "../apps/api/src/circles/store.js";
import { openDb } from "../apps/api/src/db.js";
import { loadEnv } from "../apps/api/src/env.js";
import { WalletBindings } from "../apps/api/src/wallet/bindings.js";

const DEMO_PIN = "123456";
const JOIN_CODE = "DAKAR2";
const MEMBERS = ["Aminata", "Fatou", "Moussa"] as const;
const CONTRIBUTION_SAT = 10_000;

export function createDemo(): void {
  const env = loadEnv();
  const demoDir = join(dirname(env.DB_PATH), "demo");
  const db = openDb(env.DB_PATH);
  try {
    const store = new CircleStore(db);
    if (store.getCircleByJoinCode(JOIN_CODE)) {
      console.log(`Demo circle ${JOIN_CODE} already exists.`);
      printBackups(demoDir);
      return;
    }

    const nodes = env.MEMBER_NODES.map((n) => n.name);
    const bindings = new WalletBindings(db, nodes);
    const free = nodes.filter((n) => !isBound(db, n));
    if (free.length < MEMBERS.length) {
      throw new Error(
        `Only ${free.length} of ${nodes.length} demo wallets are free. Stop \`pnpm dev\`, then run \`pnpm demo:reset\`.`,
      );
    }

    const now = Date.now();
    const circleId = randomUUID();
    mkdirSync(demoDir, { recursive: true });
    const members = MEMBERS.map((nickname) => {
      const secretKey = generateSecretKey();
      return { nickname, pubkey: getPublicKey(secretKey), backup: nip49.encrypt(secretKey, DEMO_PIN, 15) };
    });

    store.createCircle({
      id: circleId,
      name: "Marché HLM tontine",
      contributionSat: CONTRIBUTION_SAT,
      memberCount: MEMBERS.length,
      periodSeconds: 7 * 24 * 3600,
      creatorPubkey: members[0]?.pubkey ?? "",
      joinCode: JOIN_CODE,
      status: "active",
      createdAtMs: now,
    });
    for (const m of members) {
      const node = bindings.claim(m.pubkey, now);
      store.addMember(circleId, m.pubkey, m.nickname, now);
      writeFileSync(join(demoDir, `${m.nickname.toLowerCase()}.txt`), `${m.backup}\n`);
      console.log(`  ${m.nickname.padEnd(8)} wallet: ${node}`);
    }
    writeFileSync(
      join(demoDir, "README.txt"),
      `Kola demo identities (regtest only). On each phone: "I already have a backup",\npaste one code, PIN ${DEMO_PIN}. Aminata is the organizer.\n`,
    );
    console.log(`Demo circle "Marché HLM tontine" (code ${JOIN_CODE}) is ready; round 1 can start.`);
    printBackups(demoDir);
  } finally {
    db.close();
  }
}

export function resetDemo(): void {
  const env = loadEnv();
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${env.DB_PATH}${suffix}`;
    try {
      rmSync(path, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EBUSY") {
        throw new Error("The database is in use. Stop `pnpm dev`, then run `pnpm demo:reset` again.");
      }
      throw err;
    }
  }
  rmSync(join(dirname(env.DB_PATH), "demo"), { recursive: true, force: true });
  console.log("Cleared circles and wallet links.");
  createDemo();
}

function isBound(db: ReturnType<typeof openDb>, node: string): boolean {
  return db.prepare("SELECT 1 FROM wallet_bindings WHERE node = ?").get(node) !== undefined;
}

function printBackups(demoDir: string): void {
  console.log(`\nBackup codes (PIN ${DEMO_PIN}), also in ${relative(process.cwd(), demoDir)}/:`);
  for (const name of MEMBERS) {
    const file = join(demoDir, `${name.toLowerCase()}.txt`);
    if (existsSync(file)) console.log(`  ${name.padEnd(8)} ${readFileSync(file, "utf8").trim()}`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/demo.ts")) {
  try {
    if (process.argv[2] === "reset") resetDemo();
    else createDemo();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
