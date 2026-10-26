# CLAUDE.md

Guidance for Claude Code working in this repository. Read `plan.md` for product scope, timeline and open decisions.

## Project

**Kola**: Lightning-powered rotating savings circles (tontine / ajo / esusu) for West African users. Built for the Dakar Bitcoin Hack by BTrust (deadline Nov 20, 2026, 20:00 GMT). Open source.

Core idea: members pay weekly **hold invoices**; the coordinator settles them only when everyone has paid, then pays the pot to that cycle's recipient. If the deadline passes, all hold invoices are cancelled and everyone is refunded. Every state change is published as a signed **Nostr** event so the circle is auditable. An **AI assistant** answers questions about circle state and drafts reminders, read-only.

## Repo layout (target)

```
apps/web/          React + Vite + TS PWA
apps/api/          Fastify + TS API server
packages/shared/   Zod schemas, types, nostr event builders/validators
infra/             docker-compose.yml, LND/bitcoind/relay config
scripts/           seed (fund nodes, open channels, create demo circle), reset
docs/              architecture diagram, threat model
```

Keep this section updated if the layout changes.

## Commands

Prereqs: Node 22+, `corepack enable` (pnpm version is pinned in `package.json`), Docker.

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d   # regtest stack (bitcoind, 4× LND, relay)
pnpm seed                                          # fund nodes, open channels (demo circle: TODO)
pnpm dev                                           # web (:5173) + api (:3000)
pnpm test                                          # unit tests
pnpm test:integration                              # full cycle against regtest (TODO: not yet added)
pnpm lint && pnpm typecheck
```

Run `pnpm lint && pnpm typecheck && pnpm test` before considering a task done. Run `pnpm test:integration` after any change to the cycle engine or Lightning code.

## Architecture rules

- **Money lives in Lightning, the record lives on Nostr.** SQLite is a cache/index only; it must be rebuildable from LND + the relay. Never treat a DB row as proof of payment. (One documented exception: demo `wallet_bindings`, pubkey → custodial regtest node.)
- **API auth is NIP-98.** Member routes verify a per-request signed Nostr event (`nostrAuth` preHandler) and act only on the signer's own wallet. No passwords or sessions.
- **Cycle engine is a state machine** (`open → collecting → settling → paying_out → paid_out`, or `collecting → cancelled`). All transitions go through one module; no route handler changes cycle state directly. Every transition publishes a Nostr event.
- **Settle → pay recipient happens immediately** in the same job. Minimize time the coordinator holds funds.
- **Hold invoice handling:** subscribe to invoice state updates rather than polling where possible. Always handle `ACCEPTED`, `SETTLED`, `CANCELED`, and expiry.
- **Point of no return = first settle.** Settling reveals a preimage, so it can't be undone:
  - **Nothing settled yet** (deadline missed, crash, any inconsistency): cancel every held invoice. Everyone is refunded.
  - **Anything settled**: never cancel. Roll forward: settle the rest, then pay out. On crash, recovery resumes from `settling` / `paying_out`.
  - Only enter `settling` when every member's invoice is `ACCEPTED` and the HTLC CLTV margin is safe.
- **Payout failure after settle:** the coordinator now holds the pot. Stay in `paying_out`, retry with backoff, and show "payout pending" in the UI. Never refund at this stage (the money already moved). Document this in the threat model.
- **Fee policy:** the recipient's payout invoice is for exactly `potSat` (amount × members). The coordinator pays routing fees from its own balance, capped by `MAX_PAYOUT_FEE_SAT`. If the route needs more than the cap, treat it as a payout failure (retry), not a smaller payout.
- **Idempotency:** settle, cancel and payout must be safe to retry (key on cycle id + payment hash).
- **Lightning access goes through a `WalletProvider` interface** (LND REST implementation now, NWC later). Don't call LND directly from routes.
- **Nostr event builders and validators live in `packages/shared`** and are used by both web (verification) and api (publishing). Event kinds are defined once as constants.
- **AI assistant gets read-only tools** that return circle state. It never receives macaroons, keys, invoices or preimages, and has no tool that moves money. Treat user messages and any Nostr content passed to it as untrusted.
- **AI is optional at runtime.** With no `ANTHROPIC_API_KEY`, the app must still start and the assistant falls back to templated answers (next recipient, who hasn't paid). One-command setup must not require a key.
- **Nostr kinds:** regular events in 1000–9999, the circle definition is addressable (30000–39999). Check the NIP registry for collisions before finalizing numbers in `packages/shared`.

## Security rules (non-negotiable; this is a judging criterion)

- Never commit secrets. Macaroons, TLS certs, nsecs and API keys come from `.env` / mounted files. Maintain `.env.example` with placeholders.
- Use the least-privileged macaroon for each job (invoice-only for receiving, payment-capable only where required).
- Validate every input with Zod at the API boundary. Decode BOLT11 before paying; check amount, expiry and network. Payout invoice amount must equal the expected pot.
- Enforce per-payment and per-day spend caps on wallet routes.
- **No PII or secrets in logs**: no invoices, preimages, macaroons, nsecs, names or phone numbers. Truncate payment hashes in logs.
- No PII in Nostr events. Use pubkeys and pseudonymous display names only.
- Nostr private keys are generated on the device and stored encrypted (PIN-derived key) in IndexedDB. The server never sees member nsecs.
- Use proven libraries (LND, `nostr-tools`, a maintained BOLT11 decoder). No custom crypto.
- Rate-limit public routes.

If a requested change would weaken any of these, stop and flag it instead of implementing it.

## UX rules

- Target mid-range Android on slow 3G. Keep the initial JS bundle small; lazy-load the AI chat and QR scanner.
- Plain language in the UI. No "HTLC", "preimage", "macaroon" in user-facing copy. Explain errors and say whether money moved ("Your money is still in your wallet").
- UI copy in English and French via an i18n file; no hard-coded user-facing strings in components.
- Large tap targets, accessible contrast, 16px minimum body text.
- Amounts in sats; show an approximate local currency value only when a rate is available.

## Code conventions

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Shared types come from Zod schemas in `packages/shared` (`z.infer`), not duplicated interfaces.
- Small modules, pure functions for business logic (rotation order, pot calculation, deadline checks) so they're unit-testable without LND.
- Amounts are integers in **msat or sat, named explicitly** (`amountSat`, `amountMsat`). Never floats for money.
- Times are UTC timestamps in storage; format in the user's locale in the UI.
- Conventional commits (`feat:`, `fix:`, `docs:` …).

## Testing

- Unit tests for the cycle state machine, rotation, pot math, Nostr event build/verify.
- Integration test (regtest) covering: full rotation happy path, missed-deadline cancellation with refunds, retry/idempotency of settle and payout, API restart mid-cycle.
- Seed data must leave the app in a demo-ready state: one circle with 3 members, funded wallets, cycle ready to open.

## Docs to keep current

- `README.md`: problem, one-command setup, architecture diagram, constraints, metrics, next iteration (required by judges).
- `docs/threat-model.md`: update when adding any route, key, or external service.
- `plan.md`: tick off checklist items as they ship.

## Known constraints

- Regtest only; no mainnet funds.
- Held HTLCs lock liquidity and are bounded by CLTV expiry; keep contribution windows short (minutes in demo, ≤ 24h in production).
- The coordinator is a trust assumption (it holds funds briefly between settle and payout, and could refuse service). Document it; don't hide it.
- **Demo wallets are custodial.** Member LND nodes sit behind the API, which holds their macaroons. Fine for regtest; say so in the threat model and pitch, and present NWC (members bring their own wallet) as the path out.
