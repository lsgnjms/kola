import { createHash, randomBytes } from "node:crypto";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { auditCircle } from "./audit.js";
import { buildCircleEvent, eventKey, type CircleEvent } from "./events.js";

const circleId = "11111111-1111-4111-8111-111111111111";
const coordinatorSk = generateSecretKey();
const coordinatorPubkey = getPublicKey(coordinatorSk);
const memberKeys = [generateSecretKey(), generateSecretKey(), generateSecretKey()] as const;
const members = memberKeys.map((sk) => getPublicKey(sk));
const [m0 = "", m1 = "", m2 = ""] = members;
const expected = { circleId, coordinatorPubkey };

const preimages = members.map(() => randomBytes(32).toString("hex"));
const hashOf = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const payoutPreimage = randomBytes(32).toString("hex");

const signed = (event: CircleEvent, sk: Uint8Array = coordinatorSk) =>
  finalizeEvent(buildCircleEvent(event, { coordinatorPubkey, nowS: 1_700_000_000 }), sk);

const round = { circleId, cycleIndex: 0, attempt: 1 };
const facts = (): CircleEvent[] => [
  {
    type: "circle_defined",
    circleId,
    definition: {
      id: circleId,
      contributionSat: 1000,
      periodSeconds: 604800,
      memberCount: 3,
      coordinatorPubkey,
      rotation: members,
    },
  },
  {
    type: "cycle_opened",
    ...round,
    recipient: m0,
    deadlineMs: 1,
    contributions: members.map((member, i) => ({ member, paymentHash: hashOf(preimages[i] ?? "") })),
  },
  ...members.map((member, i): CircleEvent => ({
    type: "contribution_settled",
    ...round,
    member,
    paymentHash: hashOf(preimages[i] ?? ""),
    preimage: preimages[i] ?? "",
  })),
  {
    type: "payout_sent",
    ...round,
    recipient: m0,
    amountSat: 3000,
    paymentHash: hashOf(payoutPreimage),
    preimage: payoutPreimage,
  },
];

const joins = () =>
  memberKeys.map((sk, i) =>
    signed({ type: "circle_joined", circleId, member: members[i] ?? "", contributionSat: 1000, memberCount: 3 }, sk),
  );

const honest = () => [...joins(), ...facts().map((f) => signed(f))];
const codes = (raw: unknown[]) => auditCircle(raw, expected).problems.map((p) => p.code);

describe("auditCircle", () => {
  it("accepts an honest record, in order, whatever order the relay returns", () => {
    const shuffled = honest().reverse();
    const result = auditCircle(shuffled, expected);
    expect(result.problems).toEqual([]);
    expect(result.entries.map((e) => e.event.type)).toEqual([
      "circle_defined",
      "circle_joined",
      "circle_joined",
      "circle_joined",
      "cycle_opened",
      "contribution_settled",
      "contribution_settled",
      "contribution_settled",
      "payout_sent",
    ]);
  });

  it("ignores exact duplicates and other circles' events", () => {
    const other = finalizeEvent(
      buildCircleEvent(
        { type: "circle_joined", circleId: "22222222-2222-4222-8222-222222222222", member: m0, contributionSat: 1, memberCount: 2 },
        { coordinatorPubkey, nowS: 1 },
      ),
      memberKeys[0],
    );
    const all = honest();
    expect(auditCircle([...all, ...all, other], expected).entries).toHaveLength(all.length);
  });

  it("drops a tampered event and reports it", () => {
    const all = honest();
    const last = all.at(-1);
    if (!last) throw new Error("empty");
    const forged = { ...last, content: last.content.replace('"amountSat":3000', '"amountSat":300') };
    const result = auditCircle([...all.slice(0, -1), forged], expected);
    expect(result.problems.map((p) => p.code)).toContain("bad_signature");
    expect(result.entries.some((e) => e.event.type === "payout_sent")).toBe(false);
  });

  it("rejects coordinator statements signed by anyone else", () => {
    const fake = signed(facts()[1] as CircleEvent, generateSecretKey());
    expect(codes([...joins(), signed(facts()[0] as CircleEvent), fake])).toContain("wrong_signer");
  });

  it("rejects a join the member didn't sign: the coordinator can't invent members", () => {
    const forged = signed({ type: "circle_joined", circleId, member: m2, contributionSat: 1000, memberCount: 3 });
    expect(codes([...joins().slice(0, 2), forged, ...facts().map((f) => signed(f))])).toEqual(
      expect.arrayContaining(["wrong_signer", "unjoined_member"]),
    );
  });

  it("catches a preimage that doesn't match its committed hash", () => {
    const bad = randomBytes(32).toString("hex");
    const record = facts().map((f) => (f.type === "contribution_settled" && f.member === m1 ? { ...f, preimage: bad } : f));
    expect(codes([...joins(), ...record.map((f) => signed(f))])).toContain("preimage_mismatch");
  });

  it("catches a payment hash that wasn't committed when the round opened", () => {
    const other = hashOf(randomBytes(32).toString("hex"));
    const record = facts().map((f) => (f.type === "contribution_settled" && f.member === m1 ? { ...f, paymentHash: other } : f));
    expect(codes([...joins(), ...record.map((f) => signed(f))])).toContain("hash_mismatch");
  });

  it("catches a short pot, the wrong recipient, and a payout before everyone was collected", () => {
    const edit = (patch: Partial<Extract<CircleEvent, { type: "payout_sent" }>>) =>
      facts().map((f) => (f.type === "payout_sent" ? { ...f, ...patch } : f));
    expect(codes([...joins(), ...edit({ amountSat: 2999 }).map((f) => signed(f))])).toContain("wrong_amount");
    expect(codes([...joins(), ...edit({ recipient: m1 }).map((f) => signed(f))])).toContain("wrong_recipient");
    const partial = facts().filter((f) => !(f.type === "contribution_settled" && f.member === m2));
    expect(codes([...joins(), ...partial.map((f) => signed(f))])).toContain("payout_before_settled");
  });

  it("catches money collected in a round reported as cancelled", () => {
    const cancelled: CircleEvent = { type: "cycle_cancelled", ...round, missing: [m2] };
    expect(codes([...honest(), signed(cancelled)])).toContain("settled_after_cancel");
  });

  it("an empty record has no entries and no complaints", () => {
    expect(auditCircle([], expected)).toEqual({ entries: [], problems: [] });
  });
});

describe("eventKey", () => {
  it("treats a re-announced fact as the same fact, and a new attempt as a new one", () => {
    const held: CircleEvent = { type: "contribution_held", ...round, member: m0, paymentHash: "a".repeat(64) };
    expect(eventKey(held)).toBe(eventKey({ ...held }));
    expect(eventKey(held)).not.toBe(eventKey({ ...held, attempt: 2 }));
    expect(eventKey(held)).not.toBe(eventKey({ ...held, member: m1 }));
  });
});
