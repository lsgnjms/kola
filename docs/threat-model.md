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

LND's TLS certificate is pinned as the only trusted CA for REST calls.

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
| API abuse | Global rate limit, 64 KB body limit, Zod on every route | Partial (routes pending) |
