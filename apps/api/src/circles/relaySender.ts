import { Relay } from "nostr-tools/relay";
import type { RelaySend } from "./publisher.js";

/** Sends events to one relay, reconnecting when needed. Rejects if the relay refuses or is down. */
export function relaySender(url: string): RelaySend {
  let relay: Relay | null = null;
  return async (event) => {
    if (!relay?.connected) relay = await Relay.connect(url);
    await relay.publish(event);
  };
}
