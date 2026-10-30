/**
 * Smoke test of LndRestWallet against the seeded regtest stack. Exercises the
 * real REST paths and checks the least-privilege macaroons actually restrict.
 * Usage: pnpm seed && pnpm smoke
 */
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LndRestWallet } from "../apps/api/src/wallet/lnd/LndRestWallet.js";
import { lndWalletFromFiles } from "../apps/api/src/wallet/lnd/fromFiles.js";
import { HttpsLndTransport } from "../apps/api/src/wallet/lnd/transport.js";

const data = (p: string) => fileURLToPath(new URL(`../infra/data/${p}`, import.meta.url));

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const cert = await readFile(data("coordinator/tls.cert"));
  const mac = async (n: string) => (await readFile(data(`coordinator/kola/${n}.macaroon`))).toString("hex");
  const transport = (m: string) => new HttpsLndTransport({ baseUrl: "https://localhost:8081", tlsCert: cert, macaroonHex: m });
  const invoiceT = transport(await mac("invoice"));
  const payoutT = transport(await mac("payout"));
  const coordinator = new LndRestWallet(invoiceT, payoutT);

  const alice = await lndWalletFromFiles({
    restUrl: "https://localhost:8082",
    tlsCertPath: data("alice/tls.cert"),
    invoiceMacaroonPath: data("alice/kola/wallet.macaroon"),
    payoutMacaroonPath: data("alice/kola/wallet.macaroon"),
  });

  // Balances
  const cb = await coordinator.getBalanceSat();
  check("coordinator balance readable", cb.localSat > 0, `${cb.localSat} sat local`);
  const ab = await alice.getBalanceSat();
  check("alice balance readable", ab.localSat > 0, `${ab.localSat} sat local`);

  // Coordinator pays a regular alice invoice (payout path)
  const inv = await alice.createInvoice({ amountSat: 1234, expirySeconds: 600, memo: "smoke" });
  const decoded = await coordinator.decodeInvoice(inv.paymentRequest);
  check("decode amount/network", decoded.amountSat === 1234 && decoded.network === "regtest");
  check("decode hash matches", decoded.paymentHash === inv.paymentHash);
  check("lookupPayment unknown → null", (await coordinator.lookupPayment(inv.paymentHash)) === null);
  const paid = await coordinator.payInvoice({
    paymentRequest: inv.paymentRequest,
    paymentHash: inv.paymentHash,
    maxFeeSat: 10,
    timeoutSeconds: 30,
  });
  check("coordinator pays alice", paid.status === "succeeded", JSON.stringify(paid));
  const again = await coordinator.payInvoice({
    paymentRequest: inv.paymentRequest,
    paymentHash: inv.paymentHash,
    maxFeeSat: 10,
    timeoutSeconds: 30,
  });
  check("second pay is a no-op", again.status === "succeeded");
  const received = await alice.listReceived({ limit: 10 });
  check("alice history shows receipt", received.some((t) => t.paymentHash === inv.paymentHash && t.amountSat === 1234));

  // Hold invoice: alice pays, coordinator sees ACCEPTED, then cancels → alice refunded
  const preimage = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");
  const hold = await coordinator.createHoldInvoice({
    paymentHash: hash,
    amountSat: 5000,
    expirySeconds: 600,
    cltvExpiryDelta: 80,
    memo: "smoke hold",
  });
  check("hold invoice created OPEN", (await coordinator.lookupInvoiceState(hash)) === "OPEN");

  const states: string[] = [];
  const unsubscribe = coordinator.subscribeInvoice(hash, {
    onState: (s) => states.push(s),
    onError: () => {},
  });
  const pay = alice.payInvoice({ paymentRequest: hold.paymentRequest, paymentHash: hash, maxFeeSat: 10, timeoutSeconds: 60 });
  await waitFor(async () => (await coordinator.lookupInvoiceState(hash)) === "ACCEPTED");
  check("hold invoice ACCEPTED while held", true);
  check("subscription saw ACCEPTED", states.includes("ACCEPTED"), states.join(","));
  unsubscribe();

  // Second hold invoice to test the settle path
  const preimage2 = randomBytes(32).toString("hex");
  const hash2 = createHash("sha256").update(Buffer.from(preimage2, "hex")).digest("hex");
  const hold2 = await coordinator.createHoldInvoice({
    paymentHash: hash2,
    amountSat: 3000,
    expirySeconds: 600,
    cltvExpiryDelta: 80,
    memo: "smoke hold 2",
  });
  const pay2 = alice.payInvoice({ paymentRequest: hold2.paymentRequest, paymentHash: hash2, maxFeeSat: 10, timeoutSeconds: 60 });
  await waitFor(async () => (await coordinator.lookupInvoiceState(hash2)) === "ACCEPTED");

  await coordinator.cancelHoldInvoice(hash);
  await coordinator.cancelHoldInvoice(hash); // idempotent
  check("cancel → CANCELED (twice is fine)", (await coordinator.lookupInvoiceState(hash)) === "CANCELED");
  const r1 = await pay;
  check("alice's held payment failed back (refund)", r1.status === "failed", r1.status);

  await coordinator.settleHoldInvoice(preimage2);
  await coordinator.settleHoldInvoice(preimage2); // idempotent
  check("settle → SETTLED (twice is fine)", (await coordinator.lookupInvoiceState(hash2)) === "SETTLED");
  const r2 = await pay2;
  check("alice's held payment completed", r2.status === "succeeded", r2.status);

  let cancelSettledFailed = false;
  try {
    await coordinator.cancelHoldInvoice(hash2);
  } catch {
    cancelSettledFailed = true;
  }
  check("cancelling a settled invoice throws", cancelSettledFailed);

  const history = await alice.listPayments({ sinceMs: Date.now() - 3_600_000, limit: 50 });
  check("alice payment history lists both outcomes",
    history.some((t) => t.paymentHash === hash2 && t.status === "complete") &&
    history.some((t) => t.paymentHash === hash && t.status === "failed"));

  // Least privilege: each macaroon must be refused outside its scope
  await expectDenied("invoice macaroon cannot pay", () =>
    invoiceT.request("POST", "/v2/router/send", { payment_request: "x" }));
  await expectDenied("invoice macaroon cannot read balance", () => invoiceT.request("GET", "/v1/balance/channels"));
  await expectDenied("payout macaroon cannot create invoices", () =>
    payoutT.request("POST", "/v1/invoices", { value: "1" }));
  await expectDenied("payout macaroon cannot open channels", () =>
    payoutT.request("POST", "/v1/channels", { node_pubkey_string: "00", local_funding_amount: "20000" }));
  await expectDenied("payout macaroon cannot spend on-chain", () =>
    payoutT.request("POST", "/v1/transactions", { addr: "bcrt1qxyz", amount: "1000" }));
}

async function expectDenied(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "request was allowed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, /permission denied|verification failed|macaroon/i.test(msg), msg);
  }
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timed out waiting for condition");
}

main().catch((err: unknown) => {
  console.error("FAIL ", err instanceof Error ? err.message : err);
  process.exit(1);
});
