/** Total pot for one cycle. The recipient's payout invoice must be for exactly this amount. */
export function potSat(contributionSat: number, memberCount: number): number {
  assertSafeInt(contributionSat, "contributionSat");
  assertSafeInt(memberCount, "memberCount");
  const pot = contributionSat * memberCount;
  assertSafeInt(pot, "pot");
  return pot;
}

export function satToMsat(amountSat: number): number {
  assertSafeInt(amountSat, "amountSat");
  const msat = amountSat * 1000;
  assertSafeInt(msat, "amountMsat");
  return msat;
}

function assertSafeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
