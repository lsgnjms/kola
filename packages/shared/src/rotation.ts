import type { PubkeyHex } from "./schemas.js";

/** Who receives the pot in cycle `cycleIndex` (0-based). Rotation wraps after every member has received once. */
export function recipientForCycle(rotation: readonly PubkeyHex[], cycleIndex: number): PubkeyHex {
  if (rotation.length === 0) throw new RangeError("rotation is empty");
  if (!Number.isSafeInteger(cycleIndex) || cycleIndex < 0) {
    throw new RangeError("cycleIndex must be a non-negative integer");
  }
  // Length checked above, so the index is always in range.
  return rotation[cycleIndex % rotation.length] as PubkeyHex;
}

/** Number of cycles until `member` next receives, counting from `cycleIndex` (0 = this cycle). */
export function cyclesUntilTurn(
  rotation: readonly PubkeyHex[],
  member: PubkeyHex,
  cycleIndex: number,
): number {
  const position = rotation.indexOf(member);
  if (position === -1) throw new RangeError("member is not in the rotation");
  const current = cycleIndex % rotation.length;
  return (position - current + rotation.length) % rotation.length;
}
