import { auditCircle, type CircleEvent } from "@kola/shared";
import { generateSecretKey, type Event } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { openDb } from "../db.js";
import { NostrPublisher, type RelaySend } from "./publisher.js";

const circleId = "11111111-1111-4111-8111-111111111111";
const held: CircleEvent = {
  type: "contribution_held",
  circleId,
  cycleIndex: 0,
  attempt: 1,
  member: "a".repeat(64),
  paymentHash: "b".repeat(64),
};

function setup(send: RelaySend) {
  const warnings: string[] = [];
  const publisher = new NostrPublisher({
    db: openDb(":memory:"),
    secretKey: generateSecretKey(),
    send,
    nowS: () => 1_700_000_000,
    log: { warn: (_: unknown, msg?: string) => void warnings.push(msg ?? "") },
  });
  return { publisher, warnings };
}

/** flush() only marks events delivered while running, as it does in the server. */
async function flushRunning(publisher: NostrPublisher) {
  publisher.start();
  await publisher.flush();
  publisher.stop();
}

describe("NostrPublisher", () => {
  it("signs events the audit accepts, and a repeated fact is recorded once", async () => {
    const sent: Event[] = [];
    const { publisher } = setup(async (e) => void sent.push(e));
    await publisher.publish(held);
    await publisher.publish({ ...held });
    await flushRunning(publisher);

    expect(sent).toHaveLength(1);
    const { entries } = auditCircle(sent, { circleId, coordinatorPubkey: publisher.coordinatorPubkey });
    expect(entries.map((e) => e.event)).toEqual([held]);
  });

  it("keeps events through a relay outage and delivers them later, once", async () => {
    let up = false;
    const sent: Event[] = [];
    const { publisher, warnings } = setup(async (e) => {
      if (!up) throw new Error("relay down");
      sent.push(e);
    });
    await publisher.publish(held);
    await flushRunning(publisher);
    expect(sent).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain(held.paymentHash);

    up = true;
    await flushRunning(publisher);
    await flushRunning(publisher);
    expect(sent).toHaveLength(1);
  });

  it("never lets a relay failure reach the caller", async () => {
    const { publisher } = setup(() => Promise.reject(new Error("relay down")));
    publisher.start();
    await expect(publisher.publish(held)).resolves.toBeUndefined();
    publisher.stop();
  });
});
