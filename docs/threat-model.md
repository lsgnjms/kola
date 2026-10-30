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
| Coordinator Nostr key | `COORDINATOR_NSEC` or owner-only `data/coordinator-nostr.secret` (gitignored) | Forged coordinator statements; can't forge member joins, and proofs of payment still have to match their hashes |
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

## Member keys on the device

- Created in the browser with `nostr-tools` (`generateSecretKey`); never sent anywhere.
- Stored in IndexedDB only as a **NIP-49 `ncryptsec`**: scrypt (cost 2^15, 32 MiB,
  about 1 s on a mid-range phone) + XChaCha20-Poly1305, keyed by the member's
  6-digit PIN. Standard format, proven library, no custom crypto.
- Decrypted key is held in memory while unlocked and zeroed on lock. The app
  locks after 5 minutes in the background and on "Lock".
- After 5 wrong PINs the app makes the member wait (30 s, doubling, max 15 min),
  persisted across reloads.

- **Backup code** = the same NIP-49 `ncryptsec`, shown only after the PIN is
  re-entered (wrong PINs count toward the wait-out). Useless without the PIN.
  Restore re-encrypts at this app's scrypt cost.
- **Demo identities** (`pnpm seed` / `pnpm demo`) are regtest throwaway keys with
  the published PIN 123456, written to `data/demo/` (gitignored). Never reuse them.

**Honest limit:** a 6-digit PIN has only 10^6 possibilities. The wait protects
against someone guessing in the app, not against an attacker who copies the
IndexedDB data off an unlocked/rooted phone and brute-forces offline (scrypt makes
that cost hours, not years). In the demo the key only authorizes a custodial regtest
wallet; with NWC/mainnet we would add a longer passphrase option and key backup.

## Network exposure

- The API binds `127.0.0.1` only; browsers reach it through the web server's
  `/api` proxy. Regtest node ports are bound to `127.0.0.1` as well.
- `pnpm dev` keeps the web app on this PC. `pnpm dev:lan` (opt-in, for phone
  testing) exposes only the web dev server to the local network.
- NIP-98 signatures name the URL the browser used; the API accepts only the
  URLs listed in `PUBLIC_API_URLS`, so a request signed for another host fails.

## Public record (Nostr)

What goes on the relay: pubkeys, amounts in sats, deadlines, payment hashes, and
preimages only after settlement (each member's preimage is independent, so one
reveals nothing about the others). Circle names, nicknames, join codes and phone
numbers never do. Reading it does expose metadata: anyone who has a member's
pubkey and the relay can see that member's savings activity. Pubkeys are
per-device pseudonyms, but this is a real limit on a public relay.

**Limits of the audit:** the app learns the coordinator's pubkey from the API, so
a malicious server could present a different key along with a different record
to one member. Members comparing keys, or pinning the key in the circle
invitation, would close this. The record proves what was signed, and hashes and
proofs prove payments match; it is not itself proof that a payment moved, which
LND is. The relay port stays on loopback; phones reach it through the web
server's `/relay` path.

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
| `POST /circles` | NIP-98 | global; contribution ≤ `MAX_PAYMENT_SAT` | Creator joins as position 0 |
| `POST /circles/join` | NIP-98 | global | 6-char code (32-symbol alphabet); idempotent; full circles refuse |
| `GET /circles`, `GET /circles/:id` | NIP-98 | global | Members only; others get 404 so ids don't reveal circles |
| `POST /circles/:id/join-record` | NIP-98, member | global; signature, signer = caller, and rules all checked | Publishes the member's own signed agreement |
| `POST /circles/:id/cycles` | NIP-98, creator only | global | Opens the next round via the engine |
| `POST /circles/:id/contribute` | NIP-98, member | 10/min; same caps and checks as pay, amount must equal the contribution | Shares the per-member payment lock with `/wallet/pay` |

## Savings-circle engine

- **Preimages are derived, never stored**: `HMAC-SHA256(secret, circle/cycle/attempt/member)`.
  The database holds only payment hashes; a stolen DB can't settle anything. The
  secret comes from `COORDINATOR_PREIMAGE_SECRET` or an owner-only file next to
  the DB (`data/`, gitignored). Whoever holds it plus the invoice macaroon could
  settle held contributions early, so it is treated like a key.
- **Point of no return** is the first settle. Before it, a missed deadline or an
  invoice cancelled/expired outside the engine cancels every hold invoice
  (verified on regtest: balances restored exactly). After it, the engine only
  rolls forward, and refuses to cancel if anything is settled.
- **Restart safety**: on startup the engine reads every open round's invoice
  states from LND (not the cache) and resumes: carries on collecting, settles the
  rest, or retries the payout (persisted backoff). Covered by unit tests with
  simulated crashes and by a regtest test that restarts the API mid-round.
- **Payout** goes only to an invoice for exactly the pot, decoded and checked
  before paying; fees are capped by `MAX_PAYOUT_FEE_SAT` and paid by the coordinator.
- **Known gap**: the engine does not yet check each held HTLC's CLTV expiry
  height before settling. With short contribution windows and an 80-block delta
  this cannot bite in the demo; production needs it.

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
| Coordinator rewrites history | Records are signed and checked on each member's device: signatures, payment hashes committed when a round opens, proofs of payment, pot amount, recipient vs rotation, members' own signed joins | Implemented (`auditCircle`) |
| Relay outage | Durable outbox retries; money never waits on the relay | Implemented |
| Prompt injection into AI assistant | Read-only tools, no keys/invoices/preimages in context, untrusted-input framing | Pending |
| Relay tampering | Altered events fail signature checks and are reported | Implemented |
| Relay censorship | Partly detected: a payout whose contributions are missing is flagged, but a relay or coordinator hiding a whole round is not detectable from one relay. Publishing to several relays is the next step | Partial |
| Stolen phone | NIP-49 encrypted key, PIN wait-out after 5 tries, auto-lock; spend caps bound the damage of an unlocked phone | Implemented (see limit above) |
| Swapped request body (e.g. a different invoice) | Client signs sha256 of the exact body; server rejects mismatches | Implemented |
| Malicious server response | Web validates every response against shared Zod schemas | Implemented |
| API abuse | Global rate limit (stricter on pay), 64 KB body limit, strict Zod bodies, generic error codes (no internals leaked) | Implemented for wallet routes |
| Someone else spends a member's wallet | NIP-98 signature per request, bound to URL/method/body; replay cache | Implemented |
| Stolen API database | Holds only pubkey → node bindings; no keys, invoices or balances | Implemented |
