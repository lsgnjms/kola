# Kola · 3-minute demo video script

Structure the judges asked for: **problem → solution → impact → next steps**.
About 420 spoken words at a calm pace. Timings are targets; the demo parts can be sped up 1.5× in editing.

---

## Before you record (10 minutes)

1. **Fresh demo state.** Stop the app, then run `pnpm demo:reset` so the circle is at round 1.
2. **Short deadline for the refund scene.** In `.env`, set `CONTRIBUTION_WINDOW_SECONDS=30` (the minimum), then `pnpm start`. Set it back to `120` afterwards.
3. **Phone-shaped screen.** Either record your real phone (`pnpm start:lan`, then the phone's built-in screen recorder), or use the laptop: Chrome, F12, `Ctrl+Shift+M`, pick a phone size, zoom to 100%.
4. **Clean screen.** Close other tabs, turn on Do Not Disturb, hide the bookmarks bar.
5. **Record in pieces.** Record each scene separately and join them. The refund scene especially: record it on its own and cut the waiting.
6. **Have open in other tabs:** the README architecture diagram on GitHub, and the circle's **Record** panel.

Tools: OBS Studio (free) or the Xbox Game Bar (`Win+G`) for screen capture, and any editor (CapCut, Clipchamp) to cut and add captions.

---

## Scene 1 · The problem (0:00 – 0:25)

**Screen:** a title card on a dark green background: *"Kola · savings circles on Lightning"*. Then 2–3 simple text cards (or market photos you have rights to): *"Tontine · Ajo · Esusu · Susu"*, *"Millions save this way"*, *"…and it runs on trust."*

**Say:**
> In Dakar, Lagos and Accra, millions of people save through rotating savings circles: tontine, ajo, esusu. Everyone pays every week, and each week one person takes the pot.
> But it runs on trust. The collector holds the cash and can disappear. Nobody can prove who paid. And chasing late payers is awkward.

---

## Scene 2 · The idea (0:25 – 0:40)

**Screen:** Kola welcome screen (benefit cards visible).

**Say:**
> Kola runs your circle on Bitcoin's Lightning network. Your share is set aside, not handed over. Either everyone pays and the pot goes straight to that week's member, or everyone gets their money back automatically. Nobody ever holds the pot.

---

## Scene 3 · A real round (0:40 – 1:35)

**Screen and actions:**
1. Tap **Khady**. The wallet appears; hold 1 second on the balance card.
2. **Circles → Sandaga market tontine.** Show the green card: 30,000 sats pot, Khady receives round 1.
3. Tap **Start round 1**, then **Pay my share**. The "set aside" message appears.
4. **Settings → Switch demo person → Ousmane**, open the circle, **Pay my share**. Pause on the card: **2 of 3 paid**, countdown running, Mariama **Not paid yet**.
5. **Settings → Mariama → Pay my share.** The round completes immediately: **"Khady received 30,000 sats."**

**Say** (over the actions):
> Here's Khady's circle: three traders, ten thousand sats each.
> Khady starts the round and pays her share. It's held, not collected. She can see it, but nobody can spend it.
> Ousmane pays. Two of three, and the clock is running.
> Mariama pays last. The moment everyone has paid, Kola collects all three shares and sends the thirty thousand sats pot straight to Khady. It takes seconds.

---

## Scene 4 · Someone doesn't pay (1:35 – 2:00)

*(Recorded separately, with the 30-second deadline. Cut the waiting.)*

**Screen and actions:**
1. As Khady: **Start round 2**. Khady and Ousmane pay; Mariama doesn't.
2. Countdown reaches zero (cut most of it): the card shows **Refunded** for everyone.
3. Ousmane's **Wallet → Recent activity**: his payment shows as returned.

**Say:**
> Now Mariama doesn't pay in time. Nobody has to chase her. When the deadline passes, Kola cancels the round and every share goes back automatically. Ousmane's money is back in his wallet. Nobody lost anything.

---

## Scene 5 · Trust you can check (2:00 – 2:25)

**Screen and actions:**
1. In the circle, tap **Record**: *"All records are genuine and agree with each other"* and the list of steps.
2. Tap **Ask → Who still has to pay?**, then **Draft a reminder** and **Copy**.
3. Switch **EN → FR** in the top bar for 2 seconds.

**Say:**
> Every step is signed and published to a public record on Nostr. Each member's phone checks the signatures and payment proofs itself, so nobody can quietly rewrite who paid.
> A built-in assistant answers "who still owes?" and drafts a polite reminder, in English or French.

---

## Scene 6 · Built safely (2:25 – 2:40)

**Screen:** the README architecture diagram on GitHub (scroll slowly), then the "Security by design" section.

**Say:**
> Under the hood: each member's key is created and encrypted on their own phone. There are no passwords. The server's Lightning keys can only do one job each, every input is checked, and the AI can only read, never move money. The threat model is in the repo.

---

## Scene 7 · Impact and next steps (2:40 – 3:00)

**Screen:** a simple card: *"1 circle · 10 members · 520 payments a year"*, *"1 market · 50 circles · 26,000 payments a year"*. Then the repo link: **github.com/lsgnjms/kola**.

**Say:**
> One circle of ten makes 520 payments a year. One market with fifty circles makes twenty-six thousand, on phones people already own.
> Next: members bring their own wallets, a pilot with a real group in Dakar or Lagos, and voice in Wolof and Yoruba.
> Kola: save together, safely. It's open source. Try it in one command.

---

## Checklist after recording

- [ ] Under 3:00 total.
- [ ] Captions on (judges often watch muted), English, optionally French.
- [ ] "Test network, not real money" is visible at least once (the wallet card's label covers it).
- [ ] Set `CONTRIBUTION_WINDOW_SECONDS` back to `120` and run `pnpm demo:reset`.
- [ ] Upload (YouTube unlisted or Vimeo) and paste the link into Devpost and the README.
