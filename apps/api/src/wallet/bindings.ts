import type { DatabaseSync } from "node:sqlite";
import type { PubkeyHex } from "@kola/shared";

/**
 * Demo only: binds a member's Nostr pubkey to one of the regtest member LND
 * nodes. With NWC, members bring their own wallet and this goes away.
 */
export class WalletBindings {
  constructor(
    private readonly db: DatabaseSync,
    private readonly nodes: readonly string[],
  ) {}

  nodeFor(pubkey: PubkeyHex): string | null {
    const row = this.db.prepare("SELECT node FROM wallet_bindings WHERE pubkey = ?").get(pubkey) as
      | { node: string }
      | undefined;
    return row?.node ?? null;
  }

  /** Returns the pubkey's node, binding the first free one if needed. Null when all are taken. */
  claim(pubkey: PubkeyHex, nowMs: number): string | null {
    const existing = this.nodeFor(pubkey);
    if (existing) return existing;
    const taken = new Set(
      (this.db.prepare("SELECT node FROM wallet_bindings").all() as { node: string }[]).map((r) => r.node),
    );
    const free = this.nodes.find((n) => !taken.has(n));
    if (!free) return null;
    // node:sqlite is synchronous, so nothing can interleave between the read and this insert.
    this.db.prepare("INSERT INTO wallet_bindings (pubkey, node, created_at) VALUES (?, ?, ?)").run(pubkey, free, nowMs);
    return free;
  }
}
