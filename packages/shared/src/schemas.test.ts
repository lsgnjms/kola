import { describe, expect, it } from "vitest";
import { CircleDefinition } from "./schemas.js";

const base = {
  id: "8b2f4c0e-3d1a-4e57-9a0b-1c2d3e4f5a6b",
  name: "Marché HLM tontine",
  contributionSat: 10_000,
  periodSeconds: 7 * 24 * 3600,
  memberCount: 3,
  coordinatorPubkey: "f".repeat(64),
  rotation: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
};

describe("CircleDefinition", () => {
  it("accepts a valid circle", () => {
    expect(CircleDefinition.safeParse(base).success).toBe(true);
  });

  it("rejects a rotation that doesn't match member count", () => {
    expect(CircleDefinition.safeParse({ ...base, rotation: base.rotation.slice(0, 2) }).success).toBe(false);
  });

  it("rejects duplicate members in the rotation", () => {
    const rotation = ["a".repeat(64), "a".repeat(64), "c".repeat(64)];
    expect(CircleDefinition.safeParse({ ...base, rotation }).success).toBe(false);
  });

  it("rejects fractional sats", () => {
    expect(CircleDefinition.safeParse({ ...base, contributionSat: 10.5 }).success).toBe(false);
  });
});
