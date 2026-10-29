# Kola — Lightning Savings Circles (Plan)

> Working name: **Kola** (the kola nut is shared communally across West Africa). Rename freely.
> Hackathon: Dakar Bitcoin Hack by BTrust · Deadline **Fri Nov 20, 2026, 20:00 GMT** (21:00 Lagos)

---

## 1. Problem

Rotating savings circles (*tontine* in Senegal, *ajo/esusu* in Nigeria, *susu* in Ghana) are how millions of West Africans save, especially traders, market women and informal workers excluded from banks. Each member contributes a fixed amount every period, and each period one member takes the whole pot.

Pain points:
- **Collector risk**: the organizer holds the cash and can disappear or "borrow" from the pot.
- **Disputes**: records live in a notebook or a WhatsApp chat; nobody can prove who paid.
- **Missed payments**: chasing late members is manual and awkward.
- **Distance**: members who travel or live abroad struggle to contribute in cash.

## 2. Solution

A mobile-first PWA where a group runs a savings circle over Lightning:

1. **Wallet**: each member has a Lightning wallet in the app (receive, pay, balance, history).
2. **Trust-minimized contributions**: each period, every member pays a **hold invoice**. Funds stay locked in the payer's channel, not in a collector's pocket. Only when *every* member has paid are invoices settled and the pot paid out instantly to that period's recipient. If someone misses the deadline, all held payments are cancelled and everyone gets their money back automatically.
3. **Public, signed record on Nostr**: circle rules, membership, rotation order, every contribution (with payment hash) and every payout (with preimage proof) are published as signed Nostr events. Anyone in the circle can audit the history; nobody can quietly rewrite it.
4. **AI assistant**: plain-language reminders and Q&A ("When is my turn?", "Who hasn't paid?"). It only reads circle state and can never move money. Stretch: voice notes in Wolof / Yoruba / Pidgin.

### Primary user
**Aminata, 34, fabric seller at Marché HLM in Dakar.** Mid-range Android, patchy 3G, runs a 10-person tontine with fellow traders. She wants to stop carrying cash and stop arguing about who paid.

### Reach estimate (for the pitch)
One circle = ~10 members × 52 weekly contributions = 520 payments/year. A single market with 50 circles ≈ 26,000 payments/year. Track: circles created, on-time payment rate, payout success rate, disputes raised.

## 3. Scope

### MVP (must ship)
- [x] Docker Compose regtest stack: bitcoind + coordinator LND + 3 member LND nodes + Nostr relay, with channels opened and funded by a seed script
- [x] Wallet: balance, create invoice (QR + copy), pay invoice, transaction history
- [x] Circle: create (name, amount in sats, period, member count), invite via link/code, join, fixed rotation order
- [x] Cycle engine: open cycle → issue hold invoices → track HTLCs → settle all + pay recipient, or cancel all on deadline
- [ ] Nostr: publish circle, join, contribution, payout and cancellation events; in-app audit log that verifies signatures
- [ ] AI: Q&A over circle state + generated reminder messages
- [ ] One-command setup, seed data, a demo circle that completes a full rotation in minutes
- [ ] README, architecture diagram, threat model, 3-minute demo video

### Stretch (only if MVP is done)
- [ ] Voice input/output in Wolof, Yoruba or Pidgin
- [ ] NWC (Nostr Wallet Connect) so members can use their existing wallet instead of the built-in one
- [ ] Fiat display (XOF / NGN) using a rate feed, locked at contribution time
- [ ] Notifications via Nostr DMs (NIP-17)
- [ ] Late-payment policy options (grace period, penalty)

### Out of scope
Mainnet funds, KYC, on-chain payouts, stablecoins, native mobile apps.

## 4. Architecture

```
┌────────────────────┐        ┌──────────────────────────┐
│  PWA (React/Vite)  │  HTTPS │  API server (Node/TS)    │
│  - wallet UI       │◄──────►│  - wallet routes         │
│  - circles UI      │        │  - circle + cycle engine │
│  - audit log       │        │  - nostr publisher       │
│  - AI chat         │        │  - AI assistant (r/o)    │
│  - nostr keys      │        │  - SQLite (state cache)  │
└─────────┬──────────┘        └───┬─────────┬─────────┬──┘
          │ websocket             │ LND     │ LND     │ Claude API
          ▼                       │ REST    │ REST    ▼
┌────────────────────┐   ┌────────▼───┐ ┌───▼────────────┐
│  Nostr relay       │◄──│Coordinator │ │ Member LND     │
│  (strfry / nostr-  │   │ LND        │ │ nodes (alice,  │
│   rs-relay)        │   │ (hold      │ │ bob, carol)    │
└────────────────────┘   │  invoices) │ └───┬────────────┘
                         └──────┬─────┘     │
                                └─────┬─────┘
                                 ┌────▼─────┐
                                 │ bitcoind │
                                 │ regtest  │
                                 └──────────┘
```

**Source of truth:** Lightning for money, Nostr for the public record, SQLite only as a local cache/index that can be rebuilt from Nostr + LND.

### Cycle flow (the core of the demo)
1. Cycle *k* opens. Coordinator generates a random preimage per member (kept secret), creates a hold invoice per member, and publishes `cycle_opened`.
2. Recipient's wallet creates a payout invoice for **exactly the pot** (`amountSat × members`). The coordinator pays routing fees from its own balance, capped by `MAX_PAYOUT_FEE_SAT`.
3. Members pay. Each HTLC is held (`ACCEPTED` state). Coordinator publishes `contribution_held` per member.
4. **All held before deadline** → settle every hold invoice → pay recipient's invoice → publish `contribution_settled` × N and `payout_sent` (with payment hash + preimage).
5. **Deadline missed** → cancel all hold invoices (funds return to payers) → publish `cycle_cancelled` naming who didn't pay → reschedule.

**Point of no return is the first settle.** Before it, any problem (deadline, crash, inconsistency) cancels everything and refunds everyone. After it, the engine only rolls forward: settle the rest, then pay out. If the payout fails, the cycle stays in `paying_out` and retries; the UI shows "payout pending". Refunding is no longer possible at that point, which is why this is in the threat model.

States: `open → collecting → settling → paying_out → paid_out`, or `collecting → cancelled`.

Coordinator holds funds only for the seconds between settle and payout.

> **Hold-time caveat:** held HTLCs lock liquidity along the route and are bounded by CLTV expiry. Demo uses windows of minutes. Production should keep contribution windows short (≤ 24h) and document this as a known constraint.

### Nostr event design (draft, verify kinds against the NIP registry before finalizing)
| Event | Kind (proposed) | Signed by | Content |
|---|---|---|---|
| Circle definition | addressable `3xxxx` | creator | name, amount, period, size, rotation order, coordinator pubkey |
| Join | regular | member | circle `a` tag, acceptance of rules |
| Cycle opened | regular | coordinator | cycle #, recipient, deadline, payment hashes |
| Contribution held / settled | regular | coordinator | cycle #, member pubkey, payment hash |
| Payout sent | regular | coordinator | cycle #, recipient, amount, payment hash, preimage |
| Cycle cancelled | regular | coordinator | cycle #, missing members |

No names, phone numbers or amounts in fiat on the relay. Display names stay local or are pseudonymous.

## 5. Tech stack (defaults, change to fit the team)
- **Frontend:** React + Vite + TypeScript, PWA (service worker, installable), Tailwind
- **Backend:** Node 22 LTS + TypeScript, Fastify, Zod validation, SQLite via Drizzle or better-sqlite3
- **Lightning:** LND (REST, `invoicesrpc` for hold invoices), regtest
- **Nostr:** `nostr-tools`, local relay in Docker
- **AI:** Claude API with read-only tools over circle state
- **Infra:** Docker Compose, a `scripts/seed` that funds nodes, opens channels and creates a demo circle
- **Tests:** Vitest; an integration test that runs a full cycle (happy path + cancellation) against regtest

## 6. Security by design (judging criterion)
- **Threat model** in `docs/threat-model.md`: rogue coordinator, member who doesn't pay, relay censorship, stolen phone, prompt injection into the AI, compromised API server.
- **Least privilege:** coordinator uses a macaroon limited to invoices + payments; member wallet routes are per-member; AI has read-only tools and no access to macaroons or keys.
- **Secrets:** `.env` only, never committed; `.env.example` with placeholders; macaroons mounted read-only.
- **Input validation:** Zod on every route; invoices decoded and amount/expiry checked before paying; payout invoice amount must match the pot.
- **Spend limits:** per-payment and per-day caps on wallet routes.
- **Logging:** no PII, no invoices/preimages/macaroons in logs; log payment hashes truncated.
- **Nostr keys:** generated on device, stored in IndexedDB encrypted with a user PIN; export/backup screen.
- **Proven libraries only:** LND, nostr-tools, bolt11 decoder. No hand-rolled crypto.

## 7. UX principles (judging criterion)
- Works on a mid-range Android over 3G: small bundle (< 300 KB JS target), lazy-load the AI chat, cache shell offline.
- Plain words: "Pay this week's share", not "Settle HTLC". Sats shown alongside an approximate local amount when available.
- One primary action per screen. Large tap targets, high contrast, readable at 16px+.
- Helpful errors: "Payment didn't go through. Your money is still in your wallet. Try again?"
- French + English UI copy (Dakar audience); stretch: Wolof / Yoruba.

## 8. Timeline (Oct 26 → Nov 20)

| Dates | Milestone | Done when |
|---|---|---|
| **Oct 26–28** | Setup | Repo, Docker regtest stack up, seed script opens channels, CI runs lint + tests |
| **Oct 29–Nov 2** | Wallet | Balance, receive, pay, history working against member nodes from the PWA |
| **Nov 3–8** | Circle + cycle engine | Hold-invoice cycle works end to end (settle + cancel paths), integration test passes |
| **Nov 9–12** | Nostr | Events published for every state change; audit log verifies signatures; rebuild state from relay |
| **Nov 13–15** | AI + UX polish | Q&A + reminders; low-bandwidth test; French copy; error states |
| **Nov 16–17** | Security + docs | Threat model, README, architecture diagram, metrics section |
| **Nov 18** | Demo | 3-minute video recorded; fresh-clone setup tested on a clean machine |
| **Nov 19** | Buffer | Fix whatever broke |
| **Nov 20** | Submit | Submit on Devpost **by midday Lagos time**, well ahead of 21:00 |

Build in public throughout: short progress posts (X / Nostr) and updates in the BTrust Discord, since organizers asked for it.

## 9. Demo script (3 minutes)
1. **Problem (30s):** Aminata's tontine, the collector who vanished, the notebook.
2. **Solution (90s):**
   - Create a 3-person circle, others join via link.
   - Cycle 1: all three pay → pot lands in Alice's wallet instantly → show the Nostr audit trail.
   - Cycle 2: Carol doesn't pay → deadline → everyone refunded automatically, cancellation recorded.
   - Ask the AI: "Whose turn is it next and who still owes?"
3. **Impact (30s):** reach estimate, metrics we'd track.
4. **Next steps (30s):** NWC, mainnet pilot with one market group in Dakar/Lagos, voice in local languages.

## 10. Submission checklist
- [ ] Devpost page: description, video, screenshots, repo link
- [ ] Public open-source repo with license (MIT)
- [ ] README: problem, setup (`docker compose up` + seed), architecture diagram, constraints, metrics, next iteration
- [ ] Working wallet implementation (required by the rules)
- [ ] Threat model doc
- [ ] Demo video ≤ 3 min

## 11. Open decisions
- ~~**Payout fees / crash recovery:**~~ decided: payout invoice = exact pot, coordinator pays fees (capped); cancel before first settle, roll forward after. See §4.
- **Demo custody:** member LND nodes are run by the API in the demo (custodial). Disclose in threat model + pitch; NWC is the exit.
- **Volatility:** MVP denominates in sats. Decide whether to show fiat estimates and how to word the risk in the pitch.
- **Coordinator role:** one coordinator node per circle (simple) vs. one shared service (scales). MVP: shared service, documented as a trust assumption.
- **Missed payment policy:** MVP cancels the whole cycle; real groups may prefer settle-and-record-default. Ask a real tontine/ajo member.
- **Rotation order:** fixed at creation (MVP) vs. random draw (could use a committed random seed published on Nostr).
- **Team split:** who owns Lightning, frontend, Nostr/AI, docs/pitch.
