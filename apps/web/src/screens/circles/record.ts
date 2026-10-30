import { CIRCLE_KINDS, circleAddress, type AuditEntry, type CircleView } from "@kola/shared";
import { Relay } from "nostr-tools/relay";
import type { Translate } from "../../i18n/index.js";

const FETCH_TIMEOUT_MS = 8000;

/**
 * Reads the circle's record straight from the relay (through the web server's
 * `/relay` path), not from the API, so the API can't filter what is checked.
 */
export async function fetchRecord(view: Pick<CircleView, "id" | "coordinatorPubkey">): Promise<unknown[]> {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const relay = await Relay.connect(`${scheme}://${location.host}/relay`);
  try {
    return await new Promise<unknown[]>((resolve) => {
      const events: unknown[] = [];
      const timer = setTimeout(() => resolve(events), FETCH_TIMEOUT_MS);
      relay.subscribe(
        [{ kinds: [...CIRCLE_KINDS], "#a": [circleAddress(view.coordinatorPubkey, view.id)], limit: 1000 }],
        {
          onevent: (event) => events.push(event),
          oneose: () => {
            clearTimeout(timer);
            resolve(events);
          },
        },
      );
    });
  } finally {
    relay.close();
  }
}

/** One plain-language line for a record. `sats` formats an amount in the user's locale. */
export function describeEntry(
  t: Translate,
  entry: AuditEntry,
  nameOf: (pubkey: string) => string,
  sats: (amountSat: number) => string,
): string {
  const { event } = entry;
  switch (event.type) {
    case "circle_defined":
      return t("audit.entry.circle_defined");
    case "circle_joined":
      return t("audit.entry.circle_joined", { name: nameOf(event.member) });
    case "cycle_opened":
      return t("audit.entry.cycle_opened", { n: event.cycleIndex + 1, name: nameOf(event.recipient) });
    case "contribution_held":
      return t("audit.entry.contribution_held", { n: event.cycleIndex + 1, name: nameOf(event.member) });
    case "contribution_settled":
      return t("audit.entry.contribution_settled", { n: event.cycleIndex + 1, name: nameOf(event.member) });
    case "payout_sent":
      return t("audit.entry.payout_sent", {
        n: event.cycleIndex + 1,
        name: nameOf(event.recipient),
        amount: sats(event.amountSat),
      });
    case "cycle_cancelled":
      return t("audit.entry.cycle_cancelled", { n: event.cycleIndex + 1, names: event.missing.map(nameOf).join(", ") });
  }
}
