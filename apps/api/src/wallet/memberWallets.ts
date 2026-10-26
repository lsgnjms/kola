import { lndWalletFromFiles } from "./lnd/fromFiles.js";
import type { WalletProvider } from "./WalletProvider.js";

export interface MemberNode {
  name: string;
  restUrl: string;
  tlsCertPath: string;
  macaroonPath: string;
}

export class WalletUnavailableError extends Error {
  constructor(readonly node: string) {
    super(`wallet node ${node} is unavailable`);
    this.name = "WalletUnavailableError";
  }
}

export type WalletLoader = (node: MemberNode) => Promise<WalletProvider>;

/** Member wallets need invoice and payment rights on their own node, so one macaroon serves both. */
const loadFromFiles: WalletLoader = (node) =>
  lndWalletFromFiles({
    restUrl: node.restUrl,
    tlsCertPath: node.tlsCertPath,
    invoiceMacaroonPath: node.macaroonPath,
    payoutMacaroonPath: node.macaroonPath,
  });

/**
 * Lazily connects to member LND nodes, so the API starts (and /health works)
 * before the regtest stack is seeded.
 */
export class MemberWallets {
  private readonly cache = new Map<string, Promise<WalletProvider>>();

  constructor(
    private readonly nodes: readonly MemberNode[],
    private readonly load: WalletLoader = loadFromFiles,
  ) {}

  names(): string[] {
    return this.nodes.map((n) => n.name);
  }

  async get(name: string): Promise<WalletProvider> {
    const node = this.nodes.find((n) => n.name === name);
    if (!node) throw new WalletUnavailableError(name);
    let wallet = this.cache.get(name);
    if (!wallet) {
      wallet = this.load(node);
      this.cache.set(name, wallet);
    }
    try {
      return await wallet;
    } catch {
      // Don't cache failures: the node may come up later.
      this.cache.delete(name);
      throw new WalletUnavailableError(name);
    }
  }
}
