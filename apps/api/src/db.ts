import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Loaded via require: Vite 5 (vitest) doesn't know the `node:sqlite` builtin and
// strips its prefix on static imports.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncType;

/**
 * Local SQLite cache. Everything here must be rebuildable from LND + the relay,
 * except demo wallet bindings (see docs/threat-model.md, "Demo wallets are custodial").
 */
export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS wallet_bindings (
      pubkey     TEXT PRIMARY KEY,
      node       TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}
