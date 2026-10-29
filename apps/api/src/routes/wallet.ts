import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { memberPubkey, nostrAuth } from "../auth/nostrAuth.js";
import type { Env } from "../env.js";
import type { WalletBindings } from "../wallet/bindings.js";
import { WalletUnavailableError, type MemberWallets } from "../wallet/memberWallets.js";
import { payFromWallet, type PayError } from "../wallet/pay.js";
import type { KeyedMutex } from "../wallet/spendCaps.js";
import type { WalletProvider } from "../wallet/WalletProvider.js";

export interface WalletRouteDeps {
  env: Env;
  bindings: WalletBindings;
  wallets: MemberWallets;
  /** Shared with circle contributions: one payment at a time per member, so caps can't be raced. */
  payLock: KeyedMutex;
  nowMs: () => number;
}

const INVOICE_EXPIRY_S = 3600;
const HISTORY_LIMIT = 50;
/** Fixed memo: user-supplied memos could leak PII into shared invoices. */
const INVOICE_MEMO = "Kola";

export const PAY_ERROR_STATUS: Record<PayError, number> = {
  invalid_invoice: 400,
  wrong_network: 400,
  no_amount: 400,
  wrong_amount: 400,
  expired: 400,
  over_payment_cap: 403,
  over_daily_cap: 403,
  payment_failed: 502,
};

/**
 * Member wallet routes. Every route is NIP-98 authenticated and acts only on
 * the wallet bound to the signer's pubkey. Error bodies say whether money moved
 * so the UI can tell the member plainly.
 */
export async function walletRoutes(app: FastifyInstance, deps: WalletRouteDeps): Promise<void> {
  app.addHook(
    "preHandler",
    nostrAuth({ publicApiUrls: deps.env.PUBLIC_API_URLS, nowS: () => Math.floor(deps.nowMs() / 1000) }),
  );

  app.post("/wallet/claim", async (request, reply) => {
    const node = deps.bindings.claim(memberPubkey(request), deps.nowMs());
    if (!node) return reply.code(409).send({ error: "no_wallet_available" });
    return { ready: true };
  });

  app.get("/wallet/balance", async (request, reply) => {
    const wallet = await walletFor(deps, request, reply);
    if (!wallet) return;
    const { localSat } = await wallet.getBalanceSat();
    return { balanceSat: localSat };
  });

  const CreateInvoice = z.object({ amountSat: z.number().int().positive().max(deps.env.MAX_PAYMENT_SAT) }).strict();
  app.post("/wallet/invoices", async (request, reply) => {
    const body = CreateInvoice.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const wallet = await walletFor(deps, request, reply);
    if (!wallet) return;
    const invoice = await wallet.createInvoice({
      amountSat: body.data.amountSat,
      expirySeconds: INVOICE_EXPIRY_S,
      memo: INVOICE_MEMO,
    });
    return { paymentRequest: invoice.paymentRequest, expiresInSeconds: INVOICE_EXPIRY_S };
  });

  const PaymentRequestBody = z.object({ paymentRequest: z.string().trim().min(1).max(4096) }).strict();

  /** Lets the UI show "You are about to pay X sats" before confirming. */
  app.post("/wallet/decode", async (request, reply) => {
    const body = PaymentRequestBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const wallet = await walletFor(deps, request, reply);
    if (!wallet) return;
    try {
      const d = await wallet.decodeInvoice(body.data.paymentRequest);
      if (d.network !== deps.env.BITCOIN_NETWORK) return reply.code(400).send({ error: "wrong_network" });
      return { amountSat: d.amountSat, expiresAtMs: d.expiresAtMs };
    } catch {
      return reply.code(400).send({ error: "invalid_invoice" });
    }
  });

  app.post(
    "/wallet/pay",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = PaymentRequestBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_request", moneyMoved: false });
      const pubkey = memberPubkey(request);
      const wallet = await walletFor(deps, request, reply);
      if (!wallet) return;

      try {
        const outcome = await deps.payLock.run(pubkey, () =>
          payFromWallet(wallet, body.data.paymentRequest, {
            network: deps.env.BITCOIN_NETWORK,
            nowMs: deps.nowMs(),
            caps: { maxPaymentSat: deps.env.MAX_PAYMENT_SAT, maxDailySat: deps.env.MAX_DAILY_SPEND_SAT },
          }),
        );
        if (!outcome.ok) return reply.code(PAY_ERROR_STATUS[outcome.error]).send({ error: outcome.error, moneyMoved: false });
        return { status: outcome.status, amountSat: outcome.amountSat, feeSat: outcome.feeSat };
      } catch (err) {
        // Lost contact with the node mid-payment: we can't say whether money moved.
        request.log.error({ err }, "payment outcome unknown");
        return reply.code(503).send({ error: "payment_status_unknown", moneyMoved: null });
      }
    },
  );

  app.get("/wallet/history", async (request, reply) => {
    const wallet = await walletFor(deps, request, reply);
    if (!wallet) return;
    const [sent, received] = await Promise.all([
      wallet.listPayments({ sinceMs: 0, limit: HISTORY_LIMIT }),
      wallet.listReceived({ limit: HISTORY_LIMIT }),
    ]);
    const transactions = [...sent, ...received]
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, HISTORY_LIMIT)
      .map(({ direction, amountSat, feeSat, status, timestampMs }) => ({
        direction,
        amountSat,
        feeSat,
        status,
        timestampMs,
      }));
    return { transactions };
  });
}

/** The caller's bound wallet, or replies with no_wallet / wallet_unavailable and returns null. */
export async function walletFor(
  deps: Pick<WalletRouteDeps, "bindings" | "wallets">,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<WalletProvider | null> {
  const node = deps.bindings.nodeFor(memberPubkey(request));
  if (!node) {
    await reply.code(404).send({ error: "no_wallet" });
    return null;
  }
  try {
    return await deps.wallets.get(node);
  } catch (err) {
    if (!(err instanceof WalletUnavailableError)) throw err;
    await reply.code(503).send({ error: "wallet_unavailable", moneyMoved: false });
    return null;
  }
}

