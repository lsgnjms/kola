# Threat model

Living document. Update it when adding a route, key or external service.
Status: **draft**; covers decisions made so far (scaffold + LND wallet provider).

## Assets

| Asset | Where it lives | Impact if lost/stolen |
|---|---|---|
| Member contributions (in flight) | Held HTLCs on the coordinator LND node | Funds locked until settle/cancel; bounded by CLTV expiry |
| Pot (between settle and payout) | Coordinator LND channel balance | Coordinator could withhold payout |
| Coordinator macaroons | `infra/data/coordinator/kola/*.macaroon` (gitignored, read by API) | See *Keys* below |
| Hold-invoice preimages | API process memory / DB until settle | Early leak lets a member's payment be settled before everyone has paid |
| Coordinator Nostr key | `.env` (`COORDINATOR_NSEC`) | Forged circle history |
| Member Nostr keys | Member device, IndexedDB, PIN-encrypted | Impersonation of that member's join/consent events |

## Keys and least privilege

The coordinator never uses LND's `admin.macaroon`. `pnpm seed` bakes two
**URI-scoped** macaroons, so each one can only call the listed RPC methods:

| Macaroon | Allowed RPCs | Cannot |
|---|---|---|
| `invoice.macaroon` | AddHoldInvoice, SettleInvoice, CancelInvoice, SubscribeSingleInvoice, LookupInvoice, AddInvoice | Send any payment |
| `payout.macaroon` | DecodePayReq, SendPaymentV2, TrackPaymentV2, ChannelBalance | Open/close channels, spend on-chain, create or settle invoices |

Each demo member node gets a `wallet.macaroon` scoped to AddInvoice,
LookupInvoice, ListInvoices, DecodePayReq, ListPayments, ChannelBalance,
SendPaymentV2 and TrackPaymentV2 on **that member's own node** only.

LND's TLS certificate is pinned as the only trusted CA for REST calls.

## Authentication (wallet routes)

Every `/wallet/*` route requires a **NIP-98** signed request: the member's
on-device Nostr key signs the exact URL, method and sha256 of the body. The
server verifies the signature and acts only on the wallet bound to that pubkey.

- No passwords or sessions to steal; the server never sees member private keys.
- Events older/newer than 60 s are rejected; each signature is accepted once
  (replay cache keyed on the randomized BIP-340 signature).
- Pubkey → demo node bindings live in SQLite (`wallet_bindings`). This is the one
  table that is **not** rebuildable from LND + relay; it exists only because demo
  wallets are custodial and disappears with NWC.

## Routes

| Route | Auth | Limits | Notes |
|---|---|---|---|
| `GET /health` | none | global 100/min | Reveals only whether AI is enabled |
| `POST /wallet/claim` | NIP-98 | global | Binds a free demo node; 409 when none left |
| `GET /wallet/balance` | NIP-98 | global | |
| `POST /wallet/invoices` | NIP-98 | global; amount ≤ `MAX_PAYMENT_SAT` | Fixed memo (no user text in invoices) |
| `POST /wallet/decode` | NIP-98 | global | Preview before paying |
| `POST /wallet/pay` | NIP-98 | 10/min; per-payment + 24h caps | See below |
| `GET /wallet/history` | NIP-98 | global | Payment hashes are not returned |

`/wallet/pay` decodes via LND, checks network / amount / expiry, then enforces
`MAX_PAYMENT_SAT` and `MAX_DAILY_SPEND_SAT`. The 24h total is computed from
**LND's own payment history** (in-flight included, worst-case fee counted), so
caps survive API restarts. Payments are serialized per member so two concurrent
requests can't both slip under the cap. Every error response says whether money
moved (`moneyMoved: false`, or `null` when contact with the node was lost mid-payment).

**Residual risk:** whoever holds `payout.macaroon` can drain the coordinator's
channel balance via Lightning payments. Mitigations: per-payment and per-day spend
caps in the API, payout invoices must equal the pot exactly
(`checkInvoiceBeforePay`), and the coordinator keeps only routing-fee float between cycles.

## Trust assumptions (stated, not hidden)

1. **Coordinator holds the pot briefly.** Between the first settle and the payout
   the coordinator controls the funds. It could refuse to pay out. The cycle
   state machine never refunds after the first settle (preimages are public), so
   a failed payout stays in `paying_out` and is retried; the UI shows "payout pending".
2. **Coordinator can refuse service** (never open a cycle, never settle). Members
   lose nothing in that case: un-settled hold invoices are cancelled or expire.
3. **Demo wallets are custodial.** Member LND nodes run behind the API, which holds
   their macaroons. Acceptable for regtest only; NWC (members bring their own
   wallet) is the planned path out.

## Threats

| Threat | Mitigation | Status |
|---|---|---|
| Coordinator runs off with contributions | Hold invoices: nothing settles until everyone has paid; otherwise all cancelled | Designed; engine pending |
| Member doesn't pay | Deadline → cancel all hold invoices, everyone refunded, cancellation published on Nostr | Designed; engine pending |
| Crash mid-settlement | `recoveryAction()`: cancel all if nothing settled, roll forward if anything settled, manual review if pot is short | Implemented (`packages/shared/src/cycle.ts`) |
| Double payout on retry | `payInvoice` looks up the payment by hash first; LND also refuses duplicate hashes | Implemented |
| Paying a malicious/wrong invoice | Decode via LND, then check network, amount (exact pot for payouts), cap and expiry | Implemented (`invoiceChecks.ts`) |
| Path injection via invoice/hash in URL | Hashes validated as 64-hex, BOLT11 restricted to bech32 charset before use in paths | Implemented |
| Secrets in logs | Fastify redaction (invoices, preimages, macaroons, nsecs, names, phones); `no-console` lint rule; env errors name vars, never values | Implemented |
| Macaroon in error messages | Transport errors carry LND's message only, never headers | Implemented |
| Prompt injection into AI assistant | Read-only tools, no keys/invoices/preimages in context, untrusted-input framing | Pending |
| Relay censorship / tampering | Events are signed; clients verify; state rebuildable from LND + relay | Pending |
| Stolen phone | Nostr key encrypted with PIN-derived key; no spending key on device in demo | Pending |
| API abuse | Global rate limit (stricter on pay), 64 KB body limit, strict Zod bodies, generic error codes (no internals leaked) | Implemented for wallet routes |
| Someone else spends a member's wallet | NIP-98 signature per request, bound to URL/method/body; replay cache | Implemented |
| Stolen API database | Holds only pubkey → node bindings; no keys, invoices or balances | Implemented |
