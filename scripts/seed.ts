/**
 * Seeds the regtest stack: mines coins, funds every LND node and opens channels
 * in both directions between the coordinator and each member, so members can
 * pay contributions in and the coordinator can pay the pot out.
 *
 * Then creates the demo circle (see scripts/demo.ts).
 * Safe to re-run: existing channels and the demo circle are left alone.
 * Usage: docker compose -f infra/docker-compose.yml up -d && pnpm seed
 */
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createDemo } from "./demo.js";

const COMPOSE = ["compose", "-f", "infra/docker-compose.yml"];
const MEMBERS = ["alice", "bob", "carol"] as const;
const COORDINATOR = "coordinator";
const CHANNEL_SAT = 1_000_000;
const RPC_USER = process.env.BITCOIND_RPC_USER ?? "kola";
const RPC_PASS = process.env.BITCOIND_RPC_PASS ?? "kola-regtest-only";

function exec(service: string, args: string[]): string {
  return execFileSync("docker", [...COMPOSE, "exec", "-T", service, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function btc(...args: string[]): string {
  return exec("bitcoind", [
    "bitcoin-cli",
    "-regtest",
    `-rpcuser=${RPC_USER}`,
    `-rpcpassword=${RPC_PASS}`,
    "-rpcwallet=kola",
    ...args,
  ]);
}

function lncli<T>(node: string, ...args: string[]): T {
  return JSON.parse(exec(node, ["lncli", "--network=regtest", ...args])) as T;
}

async function retry<T>(label: string, fn: () => T, attempts = 60): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (i >= attempts) throw new Error(`${label} did not succeed after ${attempts} attempts`, { cause: err });
      await sleep(2000);
    }
  }
}

let minerAddress = "";
function mine(blocks: number): void {
  btc("generatetoaddress", String(blocks), minerAddress);
}

async function waitSynced(node: string): Promise<void> {
  await retry(`${node} sync`, () => {
    const info = lncli<{ synced_to_chain: boolean }>(node, "getinfo");
    if (!info.synced_to_chain) throw new Error("not synced");
  });
}

function pubkey(node: string): string {
  return lncli<{ identity_pubkey: string }>(node, "getinfo").identity_pubkey;
}

/** True if `node` itself opened a channel to `peer`. A channel the peer opened doesn't count: direction matters for liquidity. */
function hasChannelTo(node: string, peer: string): boolean {
  const open = lncli<{ channels: { remote_pubkey: string; initiator: boolean }[] }>(node, "listchannels").channels;
  const pending = lncli<{
    pending_open_channels: { channel: { remote_node_pub: string; initiator: string } }[];
  }>(node, "pendingchannels").pending_open_channels;
  return (
    open.some((c) => c.remote_pubkey === peer && c.initiator) ||
    pending.some((p) => p.channel.remote_node_pub === peer && p.channel.initiator === "INITIATOR_LOCAL")
  );
}

function fund(node: string, utxos: number): void {
  for (let i = 0; i < utxos; i++) {
    const { address } = lncli<{ address: string }>(node, "newaddress", "p2wkh");
    btc("sendtoaddress", address, "0.5");
  }
}

function connectPeer(from: string, to: string, toPubkey: string): void {
  try {
    exec(from, ["lncli", "--network=regtest", "connect", `${toPubkey}@${to}:9735`]);
  } catch {
    // Already connected.
  }
}

function openChannel(from: string, to: string, toPubkey: string): void {
  if (hasChannelTo(from, toPubkey)) {
    console.log(`  ${from} → ${to}: already open`);
    return;
  }
  connectPeer(from, to, toPubkey);
  lncli(from, "openchannel", `--node_key=${toPubkey}`, `--local_amt=${CHANNEL_SAT}`);
  console.log(`  ${from} → ${to}: opening ${CHANNEL_SAT} sat`);
}

/** Receiving side: can create and resolve invoices, cannot send money. */
const INVOICE_URIS = [
  "/invoicesrpc.Invoices/AddHoldInvoice",
  "/invoicesrpc.Invoices/SettleInvoice",
  "/invoicesrpc.Invoices/CancelInvoice",
  "/invoicesrpc.Invoices/SubscribeSingleInvoice",
  "/lnrpc.Lightning/LookupInvoice",
  "/lnrpc.Lightning/AddInvoice",
];

/** Payout side: can pay invoices, cannot open/close channels or spend on-chain. */
const PAYOUT_URIS = [
  "/lnrpc.Lightning/DecodePayReq",
  "/routerrpc.Router/SendPaymentV2",
  "/routerrpc.Router/TrackPaymentV2",
  "/lnrpc.Lightning/ChannelBalance",
];

/** Member wallet (demo custody): receive, pay and read history on the member's own node only. */
const MEMBER_WALLET_URIS = [
  "/lnrpc.Lightning/AddInvoice",
  "/lnrpc.Lightning/LookupInvoice",
  "/lnrpc.Lightning/ListInvoices",
  "/lnrpc.Lightning/DecodePayReq",
  "/lnrpc.Lightning/ListPayments",
  "/lnrpc.Lightning/ChannelBalance",
  "/routerrpc.Router/SendPaymentV2",
  "/routerrpc.Router/TrackPaymentV2",
];

function bakeMacaroon(node: string, name: string, uris: string[]): void {
  const path = `/root/.lnd/kola/${name}.macaroon`;
  exec(node, ["sh", "-c", `mkdir -p /root/.lnd/kola && rm -f ${path}`]);
  exec(node, ["lncli", "--network=regtest", "bakemacaroon", `--save_to=${path}`, ...uris.map((u) => `uri:${u}`)]);
  console.log(`  ${node}/${name}.macaroon: ${uris.length} methods`);
}

async function main(): Promise<void> {
  const nodes = [COORDINATOR, ...MEMBERS];

  console.log("Waiting for bitcoind…");
  await retry("bitcoind", () => {
    try {
      btc("getwalletinfo");
    } catch {
      try {
        btc("loadwallet", "kola");
      } catch {
        exec("bitcoind", [
          "bitcoin-cli",
          "-regtest",
          `-rpcuser=${RPC_USER}`,
          `-rpcpassword=${RPC_PASS}`,
          "createwallet",
          "kola",
        ]);
      }
    }
  });
  minerAddress = btc("getnewaddress");
  // Always at least one fresh block: LND reports "not synced" while the newest block is hours old.
  mine(Math.max(1, 101 - Number(btc("getblockcount"))));

  console.log("Waiting for LND nodes…");
  for (const node of nodes) await waitSynced(node);

  console.log("Funding nodes…");
  // The coordinator opens one channel per member, so give it one UTXO each.
  fund(COORDINATOR, MEMBERS.length);
  for (const m of MEMBERS) fund(m, 1);
  mine(6);
  for (const node of nodes) await waitSynced(node);

  console.log("Opening channels…");
  const coordinatorPubkey = pubkey(COORDINATOR);
  for (const m of MEMBERS) {
    openChannel(m, COORDINATOR, coordinatorPubkey);
    openChannel(COORDINATOR, m, pubkey(m));
  }
  mine(6);

  // After a Docker restart containers get new IPs, so LND can't reach the addresses it saved.
  for (const m of MEMBERS) connectPeer(m, COORDINATOR, coordinatorPubkey);

  console.log("Waiting for channels to become active…");
  for (const node of nodes) {
    await retry(`${node} channels`, () => {
      const { num_active_channels, num_pending_channels } = lncli<{
        num_active_channels: number;
        num_pending_channels: number;
      }>(node, "getinfo");
      const expected = node === COORDINATOR ? MEMBERS.length * 2 : 2;
      if (num_pending_channels > 0 || num_active_channels < expected) {
        mine(1);
        throw new Error("channels not active yet");
      }
    });
  }

  console.log("Baking least-privilege coordinator macaroons…");
  bakeMacaroon(COORDINATOR, "invoice", INVOICE_URIS);
  bakeMacaroon(COORDINATOR, "payout", PAYOUT_URIS);
  for (const m of MEMBERS) bakeMacaroon(m, "wallet", MEMBER_WALLET_URIS);

  console.log("Creating the demo circle…");
  try {
    await createDemo();
    console.log("\nSeed complete: nodes funded, channels active, demo circle ready.");
  } catch (err) {
    // The nodes are fine; only the demo circle couldn't be created (wallets in use).
    console.warn(`\nNodes funded and channels active, but no demo circle: ${err instanceof Error ? err.message : err}`);
  }

  // Regtest writes its chain index rarely, so an unclean Docker or PC shutdown can lose it.
  // This RPC forces a flush. Only the seed mines blocks, so the chain is safe from here on.
  btc("gettxoutsetinfo");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
